@echo off
echo.
echo    Gentle OpenCode - Uninstaller
echo    -----------------------------
echo.
echo    This will remove opencode, gentle-ai, config, and shortcuts.
echo    Engram database will be preserved (use -RemoveEngram to wipe it).
echo    The window will stay open so you can see the result.
echo.

set "TMP_PS1=%TEMP%\gentle-uninstall.ps1"

echo    Downloading latest uninstaller...
powershell -ExecutionPolicy Bypass -Command "& { Invoke-WebRequest -UseBasicParsing -Uri 'https://github.com/ivanfernadezm99/opencode/releases/latest/download/uninstall.ps1' -OutFile '%TMP_PS1%' }"
if not exist "%TMP_PS1%" (
    echo    ERROR: Failed to download uninstaller.
    pause
    exit /b 1
)

echo    Running uninstaller...
echo.
powershell -ExecutionPolicy Bypass -File "%TMP_PS1%" %*

del "%TMP_PS1%" 2>nul
pause

