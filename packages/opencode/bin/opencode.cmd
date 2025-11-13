@echo off
setlocal enabledelayedexpansion

if defined OPENCODE_BIN_PATH (
    set "resolved=%OPENCODE_BIN_PATH%"
    goto :execute
)

rem Get the directory of this script
set "script_dir=%~dp0"
set "script_dir=%script_dir:~0,-1%"

rem Detect platform and architecture
set "platform=windows"

rem Detect architecture
if "%PROCESSOR_ARCHITECTURE%"=="AMD64" (
    set "arch=x64"
) else if "%PROCESSOR_ARCHITECTURE%"=="ARM64" (
    set "arch=arm64"
) else if "%PROCESSOR_ARCHITECTURE%"=="x86" (
    set "arch=x86"
) else (
    set "arch=x64"
)

set "base=opencode-!platform!-!arch!"
set "binary=opencode.exe"

rem Search for the binary starting from script location
set "resolved="
set "current_dir=%script_dir%"

:search_loop
if exist "%current_dir%\node_modules" (
    for /d %%d in ("%current_dir%\node_modules\%base%*") do (
        if exist "%%d\bin\%binary%" (
            set "resolved=%%d\bin\%binary%"
            goto :execute
        )
    )
)

rem Move up one directory
for %%i in ("%current_dir%") do set "parent_dir=%%~dpi"
set "parent_dir=%parent_dir:~0,-1%"

rem Check if we've reached the root
if "%current_dir%"=="%parent_dir%" goto :not_found
set "current_dir=%parent_dir%"
goto :search_loop

:not_found
echo It seems that your package manager failed to install the right version of the opencode CLI for your platform. You can try manually installing the "%name%" package >&2
exit /b 1

:execute
rem Execute the binary with all arguments in the same console window
rem Use start /b /wait to ensure it runs in the current shell context for all shells
start /b /wait "" "%resolved%" %*
exit /b %ERRORLEVEL%
