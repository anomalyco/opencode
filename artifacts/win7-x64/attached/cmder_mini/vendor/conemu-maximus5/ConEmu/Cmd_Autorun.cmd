@echo off

rem This (Cmd_Autorun /i) will install to the registry following keys
rem   [HKEY_CURRENT_USER\Software\Microsoft\Command Processor]
rem   "AutoRun"="\"C:\\Program Files\\ConEmu\\ConEmu\\cmd_autorun.cmd\""
rem Which cause auto attaching to ConEmu each started cmd.exe or tcc.exe
rem If ConEmu (GUI) was not started yes, new instance will be started.

set FORCE_NEW_WND=NO
set FORCE_NEW_WND_CMD=

rem Detect our server executable
if defined PROCESSOR_ARCHITEW6432 goto x64
if "%PROCESSOR_ARCHITECTURE%"=="AMD64" goto x64
goto x86
:x64
set ConEmuC1="%~dp0ConEmuC64.exe"
set ConEmuC2="%~dp0ConEmuC.exe"
set ConEmuC3=ConEmuC64.exe
goto con_find
:x86
set ConEmuC1="%~dp0ConEmuC.exe"
set ConEmuC2="%~dp0ConEmuC.exe"
set ConEmuC3=ConEmuC.exe
goto con_find
:con_find
set ConEmuPath=%ConEmuC1%
if exist %ConEmuPath% goto con_found
set ConEmuPath=%ConEmuC2%
if exist %ConEmuPath% goto con_found
set ConEmuPath=%ConEmuC3%
if exist %ConEmuPath% goto con_found
set ConEmuPath=
goto notfound
:con_found


if "%~1"=="" goto noparm
goto checkparm

:noparm
rem AutoUpdate in progress?
if defined ConEmuInUpdate (
echo ConEmu auto update in progress, Cmd_Autorun skipped
goto fin
)

rem First, check ConEmuHWND variable, if it is absent - we are not in ConEmu
if "%ConEmuHWND%"=="" goto noconemu

rem But we also need to check, is console is really in ConEmu tab,
rem or just "ConEmuHWND" was set (or inherited) to any value?
call %ConEmuPath% /IsConEmu > nul
if errorlevel 2 goto noconemu
if errorlevel 1 goto conemufound
goto noconemu


:checkparm
if "%~1"=="/?" goto help
if "%~1"=="-?" goto help
if "%~1"=="--?" goto help
if "%~1"=="-help" goto help
if "%~1"=="--help" goto help

if "%~1"=="/i" goto install
if "%~1"=="-i" goto install

if "%~1"=="/u" goto uninstall
if "%~1"=="-u" goto uninstall

call :check_new "%~1"

rem Memorize...
rem "TERM" variable may be defined in OS.
rem rem Под телнетом - не запускать!
rem rem TODO: IsTelnet
rem if not "%TERM%"=="" goto termfound

rem Memorize...
rem Проверить, может ConEmu уже запущено?
rem Warning!!! Это не работает, если в ConMan(!) указан
rem "CreateInNewEnvironment"=dword:00000001
rem Нужно так:
rem REGEDIT4
rem [HKEY_CURRENT_USER\Software\HoopoePG_2x]
rem "CreateInNewEnvironment"=dword:00000000

:noconemu
set ConEmuHWND=
if exist %ConEmuPath% goto srv_ok
goto notfound
:srv_ok
rem Message moved to ConEmuC.exe
rem echo ConEmu autorun (c) Maximus5
rem echo Starting %ConEmuPath% in "Async Attach" mode (/GHWND=NEW)
call %ConEmuPath% /AUTOATTACH %FORCE_NEW_WND_CMD%
rem echo errorlevel=%errorlevel%
rem Issue 1003: Non zero exit codes leads to problems in some applications...
rem if errorlevel 132 if not errorlevel 133 goto rc_nocon
rem if errorlevel 121 if not errorlevel 122 goto rc_ok
rem echo ConEmu attach failed
goto fin
:rc_nocon
rem This occurs while VS build or run from telnet
rem echo ConEmu attach not available (no console window)
goto fin
:rc_ok
rem echo ConEmu attach succeeded
goto fin


:notfound
Echo ConEmu not found! "%~dp0ConEmuC.exe"
goto fin
:gui_notfound
Echo ConEmu not found! "%~dp0..\ConEmu.exe"
goto fin
:termfound
Echo ConEmu can not be started under Telnet!
goto fin
:conemufound
rem Echo ConEmu already started (%ConEmuHWND%)
goto fin

:help
echo ConEmu autorun (c) Maximus5
echo Usage
echo    cmd_autorun.cmd /?  - displays this help
echo    cmd_autorun.cmd /i  - turn ON ConEmu autorun for cmd.exe
echo    cmd_autorun.cmd /u  - turn OFF ConEmu autorun
goto fin

:install
call :check_new "%~2"
set ConEmuPath="%~dp0..\ConEmu.exe"
if exist %ConEmuPath% goto install_found
set ConEmuPath="%~dp0ConEmu.exe"
if exist %ConEmuPath% goto install_found
set ConEmuPath="%~dp0..\ConEmu64.exe"
if exist %ConEmuPath% goto install_found
set ConEmuPath="%~dp0ConEmu64.exe"
if exist %ConEmuPath% goto install_found
goto gui_notfound
:install_found
echo ConEmu autorun (c) Maximus5
echo Enabling autorun (NewWnd=%FORCE_NEW_WND%)
call %ConEmuPath% /autosetup 1 "%~0" %FORCE_NEW_WND_CMD%
goto CheckRet

:uninstall
set ConEmuPath="%~dp0..\ConEmu.exe"
if exist %ConEmuPath% goto uninstall_found
set ConEmuPath="%~dp0ConEmu.exe"
if exist %ConEmuPath% goto uninstall_found
set ConEmuPath="%~dp0..\ConEmu64.exe"
if exist %ConEmuPath% goto uninstall_found
set ConEmuPath="%~dp0ConEmu64.exe"
if exist %ConEmuPath% goto uninstall_found
goto gui_notfound
:uninstall_found
echo ConEmu autorun (c) Maximus5
echo Disabling autorun
call %ConEmuPath% /autosetup 0
goto CheckRet


:check_new
if "%~1"=="/GHWND=NEW" set FORCE_NEW_WND=YES
if "%~1"=="/NEW" set FORCE_NEW_WND=YES
if "%FORCE_NEW_WND%"=="YES" set FORCE_NEW_WND_CMD="/GHWND=NEW"
goto fin

:CheckRet
if errorlevel 2 echo ConEmu failed
if errorlevel 1 echo All done
goto fin

:fin
rem Issue 1003: Non zero exit codes leads to problems in some applications...
exit /B 0
