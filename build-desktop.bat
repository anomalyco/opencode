@echo off
echo ================================
echo ZFlow Desktop - Building...
echo ================================
echo.

cd /d %~dp0packages\desktop

echo Step 1: Building frontend...
echo This may take a few minutes...
call bun run build
if %errorlevel% neq 0 (
    echo.
    echo [ERROR] Frontend build failed!
    pause
    exit /b 1
)

echo.
echo Step 2: Building Tauri desktop app...
echo This will create Windows installer...
bun run tauri build

echo.
echo ================================
echo Build completed!
echo ================================
echo.
echo Output files are in: packages\desktop\src-tauri\target\release\
echo.
pause
