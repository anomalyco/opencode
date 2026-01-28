@echo off
cd /d %~dp0packages\app
echo Starting frontend dev server on port 3000...
bun run dev
pause
