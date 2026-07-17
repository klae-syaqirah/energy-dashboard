# Factory Energy Monitor

Real-time energy dashboard for the factory, fed by a **Delab PQM-1000s** network analyzer
over Modbus RTU. Shows live total load (gauge), today's load curve with the TNB peak window,
per-phase voltage/current/power, and a 7-day peak vs off-peak consumption history.

```
PQM-1000s ──RS485──> CH340 USB (COM3) ──> bridge/pqm_bridge.py ──HTTPS──> /api/ingest (Vercel)
                                            (this laptop)                     │
                                                                          Neon Postgres
                                                                              │
                                              Dashboard (Next.js) <── /api/summary, polls every 10 s
```

The official Modbus register map is saved in
[`docs/PQM-1000s-modbus-register-map-v2.0.02.txt`](docs/PQM-1000s-modbus-register-map-v2.0.02.txt).

## Setup

### 1. Database (Neon)

1. Create a free project at [neon.tech](https://neon.tech) (region: Singapore).
2. Copy `.env.example` to `.env.local` and paste your connection string into `DATABASE_URL`.
3. Pick a long random `INGEST_API_KEY` while you're there.
4. Create the table:

   ```bash
   npm run db:push
   ```

### 2. Web app

```bash
npm install
npm run dev        # http://localhost:3000
```

Deploy: push this repo to GitHub, import it in [Vercel](https://vercel.com), and set the same
`DATABASE_URL`, `INGEST_API_KEY` (and optionally `TARIFF_RM_PER_KWH`) in the Vercel project
settings.

### 3. Bridge (the laptop plugged into the meter)

```bash
cd bridge
pip install -r requirements.txt
python pqm_bridge.py --once        # sanity check: prints one reading
```

> **Close Modbus Poll first** — only one program can open COM3 at a time.

If voltages print ~240 V, you're good. If they look crazy, run with `--wordorder little`.

To start streaming, create `bridge/.env`:

```
PQM_API_URL=https://your-app.vercel.app   (or http://localhost:3000 while testing)
PQM_API_KEY=<same value as INGEST_API_KEY>
```

then run:

```bash
python pqm_bridge.py --push
```

Defaults are `--port COM3 --addr 1 --baud 9600` (parity none) — matching the plug-in module.
Readings are buffered in memory and re-sent when the connection recovers, so short WiFi drops
don't lose data. Laptop asleep = gap in the charts; that's expected for the prototype.

## Things to verify on first real run

- **Word order** of 32-bit values (see `--wordorder` above). Do the hair-dryer test: kW total
  must jump when it switches on.
- **CT/VT ratio**: varies per installation and is configured in the instrument itself. The
  bridge reads it from the meter at startup (registers 3842/3843), prints it, and stores it
  with every reading — check the printed values match what's configured on site.
- **kWh method**: today's kWh is integrated from average kW (5-min buckets). The meter's own
  lifetime counter is also stored (`energy_kwh`) for cross-checking later.

## Stack

Next.js (App Router) · Neon Postgres · Drizzle ORM · hand-rolled SVG charts (no chart lib) ·
Python + minimalmodbus bridge. Peak window (Mon–Fri 08:00–22:00, Asia/Kuala_Lumpur) and tariff
live in [`lib/config.ts`](lib/config.ts).
