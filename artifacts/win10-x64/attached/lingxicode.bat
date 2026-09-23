@echo off
REM ========================================
REM  LingxiCode Offline Launcher
REM ========================================

set OPENCODE_PARSERS_DIR=%~dp0parsers
set OPENCODE_DISABLE_AUTOUPDATE=true
set OPENCODE_DISABLE_MODELS_FETCH=true
set OPENCODE_DISABLE_LSP_DOWNLOAD=true
REM Offline switch: block npm from fetching dependencies from remote registries.
REM Set NPM_CONFIG_OFFLINE=false before launching to allow network access.
if not defined NPM_CONFIG_OFFLINE set "NPM_CONFIG_OFFLINE=true"
if not defined NPM_CONFIG_AUDIT set "NPM_CONFIG_AUDIT=false"
set "NPM_CONFIG_FETCH_RETRIES=0"
set OPENCODE_CONFIG_DIR=%~dp0config
set "PATH=%~dp0bin;%PATH%"
set OMO_DISABLE_POSTHOG=1
set OPENCODE_SCAN_DIR_PLUGINS=0
REM Preseed dependency metadata so offline startup does not invoke npm for the default config directory.
set "DEFAULT_CONFIG_DIR=%USERPROFILE%\.config\opencode"
if defined XDG_CONFIG_HOME set "DEFAULT_CONFIG_DIR=%XDG_CONFIG_HOME%\opencode"
if not exist "%DEFAULT_CONFIG_DIR%\node_modules" mkdir "%DEFAULT_CONFIG_DIR%\node_modules"
if exist "%~dp0config\package-lock.json" copy /Y "%~dp0config\package-lock.json" "%DEFAULT_CONFIG_DIR%\package-lock.json" >nul
if not defined OPENCODE_USER_ID_ENABLED set "OPENCODE_USER_ID_ENABLED=true"
if not defined OPENCODE_ENABLE_TELEMETRY set "OPENCODE_ENABLE_TELEMETRY=true"
if not defined OPENCODE_CAPTURE_CONTENT set "OPENCODE_CAPTURE_CONTENT=true"
if not defined OPENCODE_CAPTURE_HTTP_HEADERS set "OPENCODE_CAPTURE_HTTP_HEADERS=true"
if not defined OPENCODE_LLM_TIMING_MODE set "OPENCODE_LLM_TIMING_MODE=fetch"
if not defined OPENCODE_OTLP_ENDPOINT set "OPENCODE_OTLP_ENDPOINT=http://localhost:4318"
if not defined OPENCODE_OTLP_PROTOCOL set "OPENCODE_OTLP_PROTOCOL=http/json"
if not defined OPENCODE_DIFF_DETAIL_ENABLED set "OPENCODE_DIFF_DETAIL_ENABLED=true"

REM set ENTERPRISE_API_KEY=sk-your-key-here

"%~dp0bin/opencode.exe" %*
