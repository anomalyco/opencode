@echo off
cd /d %~dp0packages\opencode
echo Starting backend server on port 9999...
bun run ./src/index.ts serve --hostname 0.0.0.0 --port 9999
pause
