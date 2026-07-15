@echo off
echo.
echo    Gentle OpenCode - One-Click Installer
echo    ------------------------------------
echo.
echo    This will install opencode + gentle-ai in a few minutes.
echo    The window will stay open so you can see the result.
echo.

if exist "%~dp0install.ps1" (
    echo    Using local install.ps1
    powershell -ExecutionPolicy Bypass -File "%~dp0install.ps1" -Desktop %*
) else (
    echo    Downloading and installing (CLI + Desktop)...
    powershell -ExecutionPolicy Bypass -Command "& { $s = irm 'https://github.com/ivanfernadezm99/opencode/releases/latest/download/install.ps1'; $s += \"`nMain -Desktop\"; iex $s }"
)
pause
