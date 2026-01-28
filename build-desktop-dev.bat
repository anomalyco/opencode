@echo off
echo ================================
echo ZFlow Desktop - Development Mode
echo ================================
echo.

cd /d %~dp0packages\desktop

echo Starting ZFlow desktop app in development mode...
echo (Frontend dev server + Tauri window)
echo.

bun run tauri dev
