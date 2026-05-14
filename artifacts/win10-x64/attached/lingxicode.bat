@echo off
REM ========================================
REM  LingxiCode Offline Launcher
REM ========================================

set OPENCODE_PARSERS_DIR=%~dp0parsers
set OPENCODE_DISABLE_AUTOUPDATE=true
set OPENCODE_DISABLE_MODELS_FETCH=true
set OPENCODE_DISABLE_LSP_DOWNLOAD=true
set OPENCODE_DISABLE_TELEMETRY=true
set OPENCODE_CONFIG_DIR=%~dp0config
set OMO_DISABLE_POSTHOG=1
set OPENCODE_SCAN_DIR_PLUGINS=0

REM set ENTERPRISE_API_KEY=sk-your-key-here

"%~dp0bin/opencode.exe" %*