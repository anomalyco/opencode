@echo off
echo ================================
echo ZFlow Desktop - Development Mode
echo ================================
echo.

REM Check if backend is running
echo Checking if backend server is running on port 9999...
netstat -ano | findstr ":9999" | findstr "LISTENING" >nul
if %errorlevel% neq 0 (
    echo.
    echo [WARNING] Backend server is not running on port 9999!
    echo.
    echo Please start the backend first:
    echo   cd packages\opencode
    echo   bun run ./src/index.ts serve --hostname 0.0.0.0 --port 9999
    echo.
    pause
    exit /b 1
)

echo [OK] Backend server is running!
echo.
echo Starting ZFlow desktop app in development mode...
echo.

cd /d %~dp0packages\desktop
bun run tauri dev
