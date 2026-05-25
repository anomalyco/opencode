@echo off
setlocal EnableDelayedExpansion

set "script=%~dp0install.ps1"

echo SecureCode installer is starting...

where pwsh >nul 2>nul
if %errorlevel% equ 0 (
  pwsh -NoProfile -ExecutionPolicy Bypass -File "%script%"
  set "exit_code=!errorlevel!"
) else (
  powershell -NoProfile -ExecutionPolicy Bypass -File "%script%"
  set "exit_code=!errorlevel!"
)

if not "%exit_code%"=="0" (
  echo.
  echo Installer failed with exit code %exit_code%.
  timeout /t 2 /nobreak >nul
  exit /b %exit_code%
)

echo.
echo Installer completed successfully.
timeout /t 2 /nobreak >nul
