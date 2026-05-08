@echo off

rem This sample file demonstrates ability to use 256 colors
rem in Windows subsystem for Linus started in ConEmu tab.
rem TAGS: ConEmu, cygwin/msys connector, wslbridge.

ConEmuC -osverinfo > nul
if errorlevel 2560 (
  rem Windows 10 detected, OK
) else (
  call cecho "Windows 10 is required"
  exit /b 100
)

if not exist "%windir%\system32\bash.exe" (
  call cecho "Windows subsystem for linux was not installed!"
  call cecho "https://conemu.github.io/en/BashOnWindows.html#TLDR"
  exit /b 100
)

setlocal

if exist "%~dp0wslbridge-backend" goto wsl_ready

call cecho /yellow "wslbridge is not installed! download latest ConEmu distro"
goto err

:wsl_ready
echo 1: "%~1"
if "%~1" == "-run" goto do_run
ConEmuC -c "-new_console:d:%~dp0" "%~0" -new_console:c:h9999:C:"%LOCALAPPDATA%\lxss\bash.ico" -run
goto :EOF

:do_run
cd /d "%~dp0"
set "PATH=%~dp0;%PATH%"
call SetEscChar
echo %ESC%[9999H
"%~dp0..\conemu-cyg-64.exe" --wsl -t ./wsl-boot.sh
goto :EOF

:err
call cecho "wslbridge-backend was not installed properly"
timeout 10
exit /b 1
goto :EOF

