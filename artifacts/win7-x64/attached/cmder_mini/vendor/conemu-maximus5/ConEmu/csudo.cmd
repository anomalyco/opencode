@echo off

rem This is analogue for *nix "sudo" command
rem You may rename this file to "sudo.cmd" or use it "as is"
rem Example:
rem csudo dism /online /enable-feature /featurename:NetFX3 /All /Source:D:\sources\sxs /LimitAccess

setlocal

rem Change options here: https://conemu.github.io/en/SettingsEnvironment.html

rem Create new console in split or tab? Possible values: VERT, HORZ, NO
if not defined ConEmuSudoSplit set ConEmuSudoSplit=VERT

rem Show confirmation `Press Enter or Esc to close console...`
rem before automatic closing sudo console AFTER command exit
rem Possible values: YES, NO
if not defined ConEmuSudoConfirm set ConEmuSudoConfirm=YES


rem File `csudo_parms.cmd` is obsolete, prefer Environment page
rem You may override default settings in batch-file "csudo_parms.cmd"
if exist "%~dp0csudo_parms.cmd" call "%~dp0csudo_parms.cmd"


rem When possible - use Ansi Esc sequences to print errors
rem Let set "ESC" variable to char with code \x1B
set ESC=

rem It is 64-bit OS?
if not "%PROCESSOR_ARCHITECTURE%" == "AMD64" goto x32

rem First, try to use 64-bit ConEmuC
if exist "%~dp0ConEmuC64.exe" (
set ConEmuSrvPath="%~dp0ConEmuC64.exe"
goto run
)

:x32
rem Let use 32-bit ConEmuC
if exist "%~dp0ConEmuC.exe" (
set ConEmuSrvPath="%~dp0ConEmuC.exe"
goto run
)

:not_found
rem Oops, csudo located in wrong folder
if "%ConEmuANSI%" == "ON" (
echo %ESC%[1;31;40mFailed to find ConEmuC.exe or ConEmuC64.exe!%ESC%[0m
) else (
echo Failed to find ConEmuC.exe or ConEmuC64.exe
)
exit 100
goto :EOF

:run
rem Preparing switches
if /I "%ConEmuSudoSplit%" == "VERT" (
set SPLIT=sV
) else if /I "%ConEmuSudoSplit%" == "HORZ" (
set SPLIT=sH
) else (
set SPLIT=
)
if /I "%ConEmuSudoConfirm%" == "NO" (
set ConEmuNewCon=-new_console:an%SPLIT%
) else (
set ConEmuNewCon=-new_console:ac%SPLIT%
)

if "%~1" == "" (
rem There was no arguments, just start new ComSpec
%ConEmuSrvPath% /c %ComSpec% %ConEmuNewCon%
) else (
rem Start requested command
%ConEmuSrvPath% /c %* %ConEmuNewCon%
)
rem all done
