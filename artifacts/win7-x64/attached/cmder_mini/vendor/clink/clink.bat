@echo off
rem -- Copyright (c) 2012 Martin Ridgers
rem -- Portions Copyright (c) 2020-2024 Christopher Antos
rem -- License: http://opensource.org/licenses/MIT

setlocal enableextensions
set clink_profile_arg=
set clink_quiet_arg=

rem -- Mimic cmd.exe's behaviour when starting from the start menu.
if /i "%~1"=="startmenu" (
    cd /d "%userprofile%"
    shift
)

rem -- Check for the --profile option.
if /i "%~1"=="--profile" (
    set clink_profile_arg=--profile "%~2"
    shift
    shift
)

rem -- Check for the --quiet option.
if /i "%~1"=="--quiet" (
    set clink_quiet_arg= --quiet
    shift
)

rem -- If the .bat is run without any arguments, then start a cmd.exe instance.
if _%1==_ (
    call :launch
    goto :end
)

rem -- Test for autorun.
if defined CLINK_NOAUTORUN if /i "%~1"=="inject" if /i "%~2"=="--autorun" goto :end

rem -- Forward to appropriate loader, and endlocal before inject tags the prompt.
if /i "%processor_architecture%"=="x86" (
        endlocal
        "%~dp0\clink_x86.exe" %*
) else if /i "%processor_architecture%"=="arm64" (
        endlocal
        "%~dp0\clink_arm64.exe" %*
) else if /i "%processor_architecture%"=="amd64" (
    if defined processor_architew6432 (
        endlocal
        "%~dp0\clink_x86.exe" %*
    ) else (
        endlocal
        "%~dp0\clink_x64.exe" %*
    )
)

goto :end

:launch
setlocal enableextensions
set WT_PROFILE_ID=
set WT_SESSION=
start "Clink" cmd.exe /s /k ""%~dpnx0" inject %clink_profile_arg%%clink_quiet_arg%"
endlocal

:end
