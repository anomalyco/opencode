@echo off
title ProjectCombo - Mark1 + Spencer2
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "F:\OpenCodeAgentTeams\script\spark-team.ps1"
if errorlevel 1 pause
