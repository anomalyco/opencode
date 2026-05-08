@echo off

rem ************************************************************
rem If you don't know about Chocolatey (apt-get style manager)
rem read about it here: https://chocolatey.org/
rem If you are sure about installing it, execute the following
rem one-line command:
rem one-line command (select it with mouse and press RClick):
rem powershell.exe -NoProfile -InputFormat None -ExecutionPolicy
rem   Bypass -Command "iex ((New-Object System.Net.WebClient).
rem   DownloadString('https://chocolatey.org/install.ps1'))"
rem   ^&^& SET "PATH=%PATH%;%ALLUSERSPROFILE%\chocolatey\bin"
rem ************************************************************

setlocal
if "%ConEmuANSI%" == "ON" (
  set green=[1;32;40m
  set red=[1;31;40m
  set gray=[0m
  set yellow=[1;33;40m
  set white=[1;37;40m
) else (
  set green=
  set red=
  set gray=
  set white=
)
rem Do not print ending '**' because it's not so easy to pad it with spaces
echo %green%************************************************************%gray%
echo If you don't know about %yellow%Chocolatey %gray%(apt-get style manager)
echo %yellow%read about it%gray% here:%green% https://chocolatey.org/
if DEFINED ChocolateyInstall (
  if EXIST "%ChocolateyInstall%\choco.exe" (
    echo %yellow%Chocolatey is already installed on your PC:%gray%
    echo %green%  %ChocolateyInstall% %gray%
    goto done
  )
)
echo %gray%If you are sure about installing it, execute the following
echo %red%one-line command%gray% (%yellow%select it with mouse and press RClick%gray%):
echo %white%powershell.exe -NoProfile -InputFormat None -ExecutionPolicy
echo %white%  Bypass -Command "iex ((New-Object System.Net.WebClient).
echo %white%  DownloadString('https://chocolatey.org/install.ps1'))"
echo %white%  ^&^& SET "PATH=%%PATH%%;%%ALLUSERSPROFILE%%\chocolatey\bin"
:done
echo %green%************************************************************%gray%
endlocal
