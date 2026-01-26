@echo off
REM ZFlow Development Launcher

echo "================================"
echo "  ZFlow Desktop - Development Mode"
echo "================================"
echo ""

REM Add bun bin to current session
set "PATH=%USERPROFILE%\.bun\bin;%PATH%"

REM Change to project directory
cd /d H:\pythonwork\opencode\.worktrees\zflow\packages\desktop

REM Check if Rust is installed
where cargo >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo "WARNING: Rust/Cargo not found!"
    echo "Some features may not work without Rust toolchain."
    echo ""
    echo "To install Rust:"
    echo "  1. Download rustup-init.exe from https://rustup.rs/"
    echo "  2. Run: rustup-init.exe"
    echo ""
    echo "Continue anyway? (Y/N)"
    choice /C YN /M "Continue without Rust" /N
    if errorlevel 2 goto :end
)

echo "Starting ZFlow development server..."
echo ""

REM Run Tauri dev
C:\Users\yl_zh\.bun\bin\tauri.exe dev

:end
pause
