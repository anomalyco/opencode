@echo off
echo.
echo    Gentle OpenCode - One-Click Installer
echo    ------------------------------------
echo.
echo    This will install opencode + gentle-ai + desktop app.
echo    The window will stay open so you can see the result.
echo.

set "TMP_PS1=%TEMP%\gentle-install.ps1"

echo    Downloading latest installer...
powershell -ExecutionPolicy Bypass -Command "& { Invoke-WebRequest -UseBasicParsing -Uri 'https://github.com/ivanfernadezm99/opencode/releases/latest/download/install.ps1' -OutFile '%TMP_PS1%' }"
if not exist "%TMP_PS1%" (
    echo    ERROR: Failed to download installer.
    pause
    exit /b 1
)

echo    Running installer...
echo.
powershell -ExecutionPolicy Bypass -File "%TMP_PS1%" -Desktop %*

del "%TMP_PS1%" 2>nul
pause
