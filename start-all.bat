@echo off
echo Starting OpenCode development environment...
echo.
echo Frontend: http://localhost:3000
echo Backend:  http://localhost:9999
echo.
start "OpenCode Backend" cmd /c "cd /d %~dp0packages\opencode && bun run ./src/index.ts serve --hostname 0.0.0.0 --port 9999"
timeout /t 2 >nul
start "OpenCode Frontend" cmd /c "cd /d %~dp0packages\app && bun run dev"
echo.
echo Both servers started! Check the opened windows.
pause
