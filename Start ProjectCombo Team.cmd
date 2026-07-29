@echo off
setlocal
title ProjectCombo - Mark1 + Spencer2
cd /d F:\
echo Copy the complete prompt first. This launcher imports it from the clipboard.
echo Press Enter when prompted; do not paste into this window.
echo Keep this window open while Mark1 and Spencer2 work.
echo.
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "F:\OpenCodeAgentTeams\script\spark-team.ps1"
set "TEAM_EXIT=%ERRORLEVEL%"
echo.
if not "%TEAM_EXIT%"=="0" echo ProjectCombo team stopped with error code %TEAM_EXIT%.
pause
exit /b %TEAM_EXIT%
