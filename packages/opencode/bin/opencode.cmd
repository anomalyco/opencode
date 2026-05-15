@echo off
setlocal

REM Check for env var override.
if defined OPENCODE_BIN_PATH (
  "%OPENCODE_BIN_PATH%" %*
  exit /b %ERRORLEVEL%
)

REM Resolve the binary path via the Node.js resolver.
for /f "delims=" %%i in ('node "%~dp0\opencode-resolve"') do set BINARY=%%i

if not defined BINARY (
  exit /b 1
)

REM Run the binary.
"%BINARY%" %*
exit /b %ERRORLEVEL%
