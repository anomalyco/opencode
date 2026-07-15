@echo off
echo.
echo    Gentle OpenCode - Uninstaller
echo    -----------------------------
echo.
echo    This will remove opencode, gentle-ai, config, and shortcuts.
echo    Engram database will be preserved (use -RemoveEngram to wipe it).
echo    The window will stay open so you can see the result.
echo.
powershell -ExecutionPolicy Bypass -Command "irm https://github.com/ivanfernadezm99/opencode/releases/latest/download/uninstall.ps1 | iex"
pause
