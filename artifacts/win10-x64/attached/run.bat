@echo off
REM ========================================
REM  OpenCode Offline Launcher
REM ========================================

set OPENCODE_PARSERS_DIR=%~dp0parsers
set OPENCODE_DISABLE_AUTOUPDATE=true
set OPENCODE_DISABLE_MODELS_FETCH=true
set OPENCODE_CONFIG_DIR=%~dp0config

REM set ENTERPRISE_API_KEY=sk-your-key-here

"%~dp0opencode.exe" %*