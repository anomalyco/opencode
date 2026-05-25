@echo off
setlocal

set "script=%~dp0install.ps1"

where pwsh >nul 2>nul
if %errorlevel% equ 0 (
  pwsh -NoProfile -ExecutionPolicy Bypass -File "%script%"
  exit /b %errorlevel%
)

powershell -NoProfile -ExecutionPolicy Bypass -File "%script%"
