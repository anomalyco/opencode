@echo off
cd /d %~dp0packages\app

echo Stopping frontend dev server and clearing cache...
echo.

REM Kill any existing vite processes
taskkill /F /IM bun.exe 2>nul
timeout /t 1 >nul

REM Clear Vite cache
if exist node_modules\.vite (
    echo Removing Vite cache...
    rmdir /s /q node_modules\.vite
)

REM Clear .env cache
if exist node_modules\.env
    del /f /q node_modules\.env
)

echo.
echo Cache cleared! Starting frontend server...
echo.
bun run dev

pause
