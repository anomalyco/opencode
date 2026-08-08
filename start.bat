@echo off
echo ============================================
echo   Jarvis Dev Server
echo ============================================
echo.
echo Si no ves la ventana Electron abrirse, hay un error.
echo Esta ventana NO se cerrara para poder ver el error.
echo.

REM Add Bun to PATH
set PATH=%USERPROFILE%\.bun\bin;%PATH%

REM Navigate to desktop package
cd /d "%~dp0..\packages\desktop"

echo Current directory: %CD%
echo Checking if bun is available:
where bun
echo.
echo Starting dev server...
echo.

bun dev

echo.
echo ============================================
echo   El servidor se detuvo (codigo: %ERRORLEVEL%)
echo ============================================
pause
