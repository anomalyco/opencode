@echo off
rem MuhlisCode launcher: runs from source in the current directory.
set "MUHLIS_ROOT=%~dp0.."
"%USERPROFILE%\.bun\bin\bun.exe" --preload "@opentui/solid/preload" "%MUHLIS_ROOT%\packages\cli\src\index.ts" %*
