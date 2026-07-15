@echo off
echo.
echo    Gentle OpenCode - One-Click Installer
echo    ------------------------------------
echo.
echo    This will install opencode + gentle-ai in a few minutes.
echo    The window will stay open so you can see the result.
echo.

set SCRIPT_URL=https://github.com/ivanfernadezm99/opencode/releases/latest/download/install.ps1

if exist "%~dp0install.ps1" (
    echo    Using local install.ps1
    powershell -ExecutionPolicy Bypass -File "%~dp0install.ps1" %*
) else (
    echo    Downloading latest installer...
    powershell -ExecutionPolicy Bypass -Command "& { irm '%SCRIPT_URL%' | iex }"
)
pause
