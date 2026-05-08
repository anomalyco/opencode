@echo off

set ACT=setup
if "%~1"=="/u" set ACT=uninstall

if not exist "%FARHOME%\ConEmu.exe" echo "%FARHOME%\ConEmu.exe" not found & goto err
if not exist "%FARHOME%\far.exe" echo "%FARHOME%\far.exe" not found & goto err
if not exist "%~dp0FarHere.dat" echo "%~dp0FarHere.dat" not found & goto err

rem Creating 'inf' file
copy "%~dp0FarHere.dat" "%~dp0FarHere.inf">nul
if errorlevel 1 goto CantCopy
echo FarHereLocation="""%FARHOME%\ConEmu.exe"" /single /cmd ""%FARHOME%\far.exe""">>"%~dp0FarHere.inf"

rem Doing action
goto %ACT%

:setup
echo Installing Far Here
call RUNDLL32.EXE syssetup.dll,SetupInfObjectInstallAction DefaultInstall.ntx86 132 %~dp0FarHere.inf
goto done

:uninstall
echo Uninstalling Far Here
RUNDLL32.EXE syssetup.dll,SetupInfObjectInstallAction DefaultUninstall.ntx86 132 %~dp0FarHere.inf
goto done

:done
del "%~dp0FarHere.inf"

goto fin


:CantCopy
echo Creating .inf file failed.
echo "%~dp0FarHere.inf" is write protected?
goto err

:err
pause
:fin
