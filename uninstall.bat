@echo off
echo.
echo    Gentle OpenCode - Uninstaller
echo    -----------------------------
echo.
echo    This will remove opencode, gentle-ai, config, and shortcuts.
echo    Engram database will be preserved (use -RemoveEngram to wipe it).
echo    The window will stay open so you can see the result.
echo.

set SCRIPT_URL=https://github.com/ivanfernadezm99/opencode/releases/latest/download/uninstall.ps1

if exist "%~dp0uninstall.ps1" (
    echo    Using local uninstall.ps1
    powershell -ExecutionPolicy Bypass -File "%~dp0uninstall.ps1" %*
) else (
    echo    Downloading latest uninstaller...
    powershell -ExecutionPolicy Bypass -Command "& { irm '%SCRIPT_URL%' | iex }"
)
pause

