@echo off
setlocal EnableDelayedExpansion
REM ============================================================================
REM  VantaCode Windows installer (idempotent)
REM  - Installs Bun if missing
REM  - Installs JS dependencies
REM  - Builds the CLI
REM  - Links `vantacode` onto your user PATH (persisted), idempotently
REM  - Verifies with `where vantacode`
REM
REM  Re-running this script is safe: it detects what is already present and only
REM  does the missing work.
REM ============================================================================

echo.
echo === VantaCode installer ===
echo.

REM --- Resolve repo root (directory of this script) -------------------------
set "REPO_ROOT=%~dp0"
if "%REPO_ROOT:~-1%"=="\" set "REPO_ROOT=%REPO_ROOT:~0,-1%"

REM --- 1. Ensure Bun is installed -------------------------------------------
where bun >nul 2>nul
if %ERRORLEVEL%==0 (
  echo [ok] Bun already installed.
) else (
  echo [..] Bun not found. Installing Bun...
  powershell -NoProfile -ExecutionPolicy Bypass -Command "irm bun.sh/install.ps1 | iex"
  if !ERRORLEVEL! NEQ 0 (
    echo [!!] Bun install failed. Install it manually from https://bun.sh and re-run.
    exit /b 1
  )
  REM Bun installs to %USERPROFILE%\.bun\bin
  set "PATH=%USERPROFILE%\.bun\bin;%PATH%"
)

REM --- 2. Install dependencies ----------------------------------------------
echo [..] Installing dependencies (bun install)...
pushd "%REPO_ROOT%"
call bun install
if %ERRORLEVEL% NEQ 0 (
  echo [!!] bun install failed.
  popd
  exit /b 1
)

REM --- 3. Build the CLI ------------------------------------------------------
echo [..] Building the CLI...
pushd "%REPO_ROOT%\packages\opencode"
call bun run build
if %ERRORLEVEL% NEQ 0 (
  echo [!!] Build failed.
  popd
  popd
  exit /b 1
)
popd

REM --- 4. Create a vantacode.cmd shim in a stable bin dir -------------------
set "BIN_DIR=%USERPROFILE%\.vantacode\bin"
if not exist "%BIN_DIR%" mkdir "%BIN_DIR%"

set "LAUNCHER=%REPO_ROOT%\packages\opencode\bin\vantacode"
set "SHIM=%BIN_DIR%\vantacode.cmd"

REM Write (or overwrite) the shim so it always points at the current checkout.
>  "%SHIM%" echo @echo off
>> "%SHIM%" echo set "VANTACODE_BRAND=vantacode"
>> "%SHIM%" echo node "%LAUNCHER%" %%*
echo [ok] Wrote launcher shim: %SHIM%

REM --- 5. Add BIN_DIR to the user PATH (idempotent) -------------------------
echo %PATH% | find /I "%BIN_DIR%" >nul
if %ERRORLEVEL%==0 (
  echo [ok] %BIN_DIR% already on PATH for this session.
) else (
  echo [..] Adding %BIN_DIR% to your user PATH...
)

REM Read the persisted user PATH and only append if not present.
for /f "usebackq tokens=2,*" %%A in (`reg query HKCU\Environment /v Path 2^>nul`) do set "USER_PATH=%%B"
if not defined USER_PATH set "USER_PATH="

echo !USER_PATH! | find /I "%BIN_DIR%" >nul
if %ERRORLEVEL%==0 (
  echo [ok] %BIN_DIR% already persisted on user PATH.
) else (
  if defined USER_PATH (
    setx PATH "!USER_PATH!;%BIN_DIR%" >nul
  ) else (
    setx PATH "%BIN_DIR%" >nul
  )
  echo [ok] Persisted %BIN_DIR% to user PATH.
  set "PATH=%PATH%;%BIN_DIR%"
)

REM --- 6. Verify -------------------------------------------------------------
echo.
echo [..] Verifying installation...
where vantacode >nul 2>nul
if %ERRORLEVEL%==0 (
  echo [ok] `vantacode` is on PATH:
  where vantacode
) else (
  echo [ok] Installed to %BIN_DIR%\vantacode.cmd
  echo [!!] `where vantacode` did not find it in THIS terminal.
  echo      Open a NEW terminal (PATH changes only apply to new terminals^),
  echo      then run:  vantacode --version
)

popd
echo.
echo === Done. Try:  vantacode vantacode doctor ===
echo (Open a new terminal first if PATH was just updated.^)
endlocal
