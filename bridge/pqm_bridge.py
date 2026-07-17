"""
PQM-1000s -> cloud bridge.

Reads the Delab PQM-1000s over Modbus RTU (RS485 / CH340 USB converter) and either
prints the readings (default) or pushes them to the dashboard's ingest API (--push).

Register addresses come from the official map in
docs/PQM-1000s-modbus-register-map-v2.0.02.txt (0-based, function code 3).

IMPORTANT: close Modbus Poll before running this — only one program can own the COM port.

Usage:
    python pqm_bridge.py                    # print readings every 10 s (sanity check)
    python pqm_bridge.py --once             # single reading, then exit
    python pqm_bridge.py --push             # read + POST to the dashboard API
    python pqm_bridge.py --wordorder little # if 32-bit values look wrong, try this

--push needs PQM_API_URL and PQM_API_KEY, from the environment or a bridge/.env file:
    PQM_API_URL=https://your-app.vercel.app
    PQM_API_KEY=the-same-secret-as-INGEST_API_KEY-on-vercel
"""

import argparse
import json
import os
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import minimalmodbus
import serial


def load_dotenv(path: Path) -> None:
    """Tiny .env loader (KEY=VALUE lines) so we don't need python-dotenv."""
    if not path.exists():
        return
    for line in path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


def make_instrument(port: str, addr: int, baud: int) -> minimalmodbus.Instrument:
    inst = minimalmodbus.Instrument(port, addr)
    inst.serial.baudrate = baud
    inst.serial.bytesize = 8
    inst.serial.parity = serial.PARITY_NONE
    inst.serial.stopbits = 1
    inst.serial.timeout = 1.5
    inst.clear_buffers_before_each_transaction = True
    return inst


def read_block(inst: minimalmodbus.Instrument, addr: int, count: int, attempts: int = 3) -> list[int]:
    """Read registers in one request, retrying — the PQM-1000s sometimes skips a beat.

    Keep `count` small (~22 max): the meter answers 4-register reads reliably but
    goes silent on large block reads (observed with 44 registers).
    """
    last: Exception | None = None
    for _ in range(attempts):
        try:
            result = inst.read_registers(addr, count, functioncode=3)
            time.sleep(0.05)  # brief gap so back-to-back requests don't overrun the meter
            return result
        except Exception as e:  # noqa: BLE001
            last = e
            time.sleep(0.2)
    raise last if last else RuntimeError("unreachable")


def s16(v: int) -> int:
    return v - 0x10000 if v > 0x7FFF else v


def u32(words: list[int], i: int, big: bool) -> int:
    hi, lo = (words[i], words[i + 1]) if big else (words[i + 1], words[i])
    return (hi << 16) | lo


def s32(words: list[int], i: int, big: bool) -> int:
    v = u32(words, i, big)
    return v - 0x1_0000_0000 if v > 0x7FFF_FFFF else v


def u64(words: list[int], big: bool) -> int:
    w = words if big else list(reversed(words))
    return (w[0] << 48) | (w[1] << 32) | (w[2] << 16) | w[3]


def read_settings(inst: minimalmodbus.Instrument) -> dict:
    """Device code + CT/VT ratio from the settings block (regs 3840..3843).

    CT/VT ratio is configured in the instrument and varies per installation
    (per Mr. Lam), so we read it from the meter instead of hardcoding, and
    attach it to every reading as an audit trail. The instantaneous registers
    already return primary values (the meter applies the ratio itself).
    """
    block = read_block(inst, 3840, 4)
    return {
        "device_code": block[0],  # fixed 0x0001 for PQM-1000s
        "ct_ratio": block[2],
        "vt_ratio": round(block[3] * 0.1, 1),
    }


def read_meter(inst: minimalmodbus.Instrument, big: bool, settings: dict) -> dict:
    # Regs 0..43 cover amps, volts, freq, per-phase kW and PF — but the meter
    # won't answer one 44-register read, so fetch it as two aligned chunks.
    block = read_block(inst, 0, 22) + read_block(inst, 22, 22)
    energy = read_block(inst, 48, 8)    # import + export, uint64 each, x0.1 kWh
    total = read_block(inst, 256, 2)    # int32, x0.1 W

    return {
        "ts": datetime.now(timezone.utc).isoformat(),
        "a1": round(u32(block, 0, big) * 0.001, 3),
        "a2": round(u32(block, 2, big) * 0.001, 3),
        "a3": round(u32(block, 4, big) * 0.001, 3),
        "v1": round(u32(block, 8, big) * 0.1, 1),
        "v2": round(u32(block, 10, big) * 0.1, 1),
        "v3": round(u32(block, 12, big) * 0.1, 1),
        "freq": round(block[21] * 0.01, 2),
        # kW registers are in W with x0.1 multiplier -> /10 -> W -> /1000 -> kW
        "kw1": round(s32(block, 22, big) * 0.1 / 1000, 3),
        "kw2": round(s32(block, 24, big) * 0.1 / 1000, 3),
        "kw3": round(s32(block, 26, big) * 0.1 / 1000, 3),
        "pf": round(s16(block[43]) * 0.001, 3),
        "energy_kwh": round(u64(energy[0:4], big) * 0.1, 1),
        "energy_export_kwh": round(u64(energy[4:8], big) * 0.1, 1),
        "kw_total": round(s32(total, 0, big) * 0.1 / 1000, 3),
        "ct_ratio": settings["ct_ratio"],
        "vt_ratio": settings["vt_ratio"],
    }


def sanity_notes(r: dict) -> str:
    notes = []
    if not (180 <= r["v1"] <= 280):
        notes.append("V1 looks wrong for a 230/240V system -> try --wordorder little")
    if abs(r["kw_total"] - (r["kw1"] + r["kw2"] + r["kw3"])) > max(0.5, 0.1 * abs(r["kw_total"])):
        notes.append("total kW != sum of phases -> check word order / CT ratio")
    return ("  [!] " + "; ".join(notes)) if notes else ""


def push(session, url: str, key: str, buffer: list[dict]) -> bool:
    try:
        resp = session.post(
            f"{url.rstrip('/')}/api/ingest",
            json=buffer if len(buffer) > 1 else buffer[0],
            headers={"Authorization": f"Bearer {key}"},
            timeout=10,
        )
        if resp.status_code == 200:
            return True
        print(f"  push failed: HTTP {resp.status_code} {resp.text[:200]}", file=sys.stderr)
    except Exception as e:  # noqa: BLE001 — keep the loop alive on any network error
        print(f"  push failed: {e}", file=sys.stderr)
    return False


def main() -> None:
    ap = argparse.ArgumentParser(description="PQM-1000s Modbus -> dashboard bridge")
    ap.add_argument("--port", default="COM3")
    ap.add_argument("--addr", type=int, default=1)
    ap.add_argument("--baud", type=int, default=9600)
    ap.add_argument("--interval", type=float, default=10.0, help="seconds between readings")
    ap.add_argument("--once", action="store_true", help="read once and exit")
    ap.add_argument("--push", action="store_true", help="POST readings to the dashboard API")
    ap.add_argument("--wordorder", choices=["big", "little"], default="big",
                    help="32/64-bit register word order (default: big = high word first)")
    args = ap.parse_args()

    load_dotenv(Path(__file__).with_name(".env"))
    big = args.wordorder == "big"

    session = None
    api_url = api_key = None
    if args.push:
        import requests

        api_url = os.environ.get("PQM_API_URL")
        api_key = os.environ.get("PQM_API_KEY")
        if not api_url or not api_key:
            sys.exit("--push needs PQM_API_URL and PQM_API_KEY (env or bridge/.env)")
        session = requests.Session()

    inst = make_instrument(args.port, args.addr, args.baud)
    settings = read_settings(inst)
    if settings["device_code"] != 1:
        print(f"warning: device code is {settings['device_code']}, expected 1 (PQM-1000s)", file=sys.stderr)
    print(
        f"Connected to {args.port} (addr {args.addr}, {args.baud} 8N1). "
        f"CT ratio {settings['ct_ratio']}, VT ratio {settings['vt_ratio']}. Ctrl+C to stop."
    )

    buffer: list[dict] = []
    while True:
        try:
            r = read_meter(inst, big, settings)
            print(
                f"{r['ts']}  {r['kw_total']:7.2f} kW total  "
                f"| V {r['v1']:.1f}/{r['v2']:.1f}/{r['v3']:.1f}  "
                f"| A {r['a1']:.1f}/{r['a2']:.1f}/{r['a3']:.1f}  "
                f"| PF {r['pf']:.2f}  | in {r['energy_kwh']:.1f} / out {r['energy_export_kwh']:.1f} kWh"
                + sanity_notes(r)
            )
            if args.push and session:
                buffer.append(r)
                if push(session, api_url, api_key, buffer[-500:]):
                    buffer.clear()
                elif len(buffer) > 5000:
                    del buffer[: len(buffer) - 5000]
        except KeyboardInterrupt:
            raise
        except Exception as e:  # noqa: BLE001 — COM hiccups shouldn't kill the loop
            print(f"  read failed: {e}", file=sys.stderr)

        if args.once:
            if not args.push or not buffer:
                break
        time.sleep(args.interval)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\nbye 👋")
