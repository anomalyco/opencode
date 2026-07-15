@echo off
echo.
echo    Gentle OpenCode - One-Click Installer
echo    ------------------------------------
echo.
echo    This will install opencode + gentle-ai + desktop app.
echo    The window will stay open so you can see the result.
echo.

set "INSTALL_PS1=%~dp0install.ps1"

if exist "%INSTALL_PS1%" (
    echo    Using local install.ps1
) else (
    echo    Downloading installer...
    powershell -ExecutionPolicy Bypass -Command "& { Invoke-WebRequest -UseBasicParsing -Uri 'https://github.com/ivanfernadezm99/opencode/releases/latest/download/install.ps1' -OutFile '%INSTALL_PS1%' }"
    if not exist "%INSTALL_PS1%" (
        echo    ERROR: Failed to download installer.
        pause
        exit /b 1
    )
    echo    Done.
)

echo    Running installer...
echo.
powershell -ExecutionPolicy Bypass -File "%INSTALL_PS1%" -Desktop %*
pause
