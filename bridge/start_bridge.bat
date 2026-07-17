@echo off
REM Double-click to start streaming meter data to the live dashboard.
REM Close this window (or Ctrl+C) to stop.
cd /d "%~dp0"
python pqm_bridge.py --push
pause
