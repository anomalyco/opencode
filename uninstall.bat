@echo off
echo.
echo    Gentle OpenCode - Uninstaller
echo    -----------------------------
echo.
echo    This will remove opencode, gentle-ai, config, and shortcuts.
echo    Engram database will be preserved (use -RemoveEngram to wipe it).
echo    The window will stay open so you can see the result.
echo.

set "UNINSTALL_PS1=%~dp0uninstall.ps1"

if exist "%UNINSTALL_PS1%" (
    echo    Using local uninstall.ps1
) else (
    echo    Downloading uninstaller...
    powershell -ExecutionPolicy Bypass -Command "& { Invoke-WebRequest -UseBasicParsing -Uri 'https://github.com/ivanfernadezm99/opencode/releases/latest/download/uninstall.ps1' -OutFile '%UNINSTALL_PS1%' }"
    if not exist "%UNINSTALL_PS1%" (
        echo    ERROR: Failed to download uninstaller.
        pause
        exit /b 1
    )
    echo    Done.
)

echo    Running uninstaller...
echo.
powershell -ExecutionPolicy Bypass -File "%UNINSTALL_PS1%" %*
pause

