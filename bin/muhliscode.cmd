@echo off
rem MuhlisCode launcher: runs from source and opens the folder you are standing in.
setlocal
set "ORIG=%CD%"
set "MUHLIS_ROOT=%~dp0.."
set "BUN=%USERPROFILE%\.bun\bin\bun.exe"
rem Policy that denies Chinese-company providers and the upstream hosted free tier (see security/SECURITY_POLICY.md).
set "OPENCODE_CONFIG=%~dp0muhliscode-policy.json"

rem The CLI needs packages\cli as its working directory (bunfig preload); the project folder is passed as an argument.
cd /d "%MUHLIS_ROOT%\packages\cli"
set "FIRST=%~1"
if "%FIRST%"=="" goto openhere
if "%FIRST:~0,1%"=="-" goto openhere
"%BUN%" run src/index.ts %* --standalone
goto end

:openhere
"%BUN%" run src/index.ts %* --standalone "%ORIG%"

:end
endlocal
