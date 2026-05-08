@echo off

if defined PROCESSOR_ARCHITEW6432 goto x64
if "%PROCESSOR_ARCHITECTURE%"=="AMD64" goto x64
goto x86
:x64
set ConEmuC1=%~dp0ConEmuC64.exe
set ConEmuC2=%~dp0ConEmuC.exe
set ConEmuC3=ConEmuC64.exe
goto con_find
:x86
set ConEmuC1=%~dp0ConEmuC.exe
set ConEmuC2=%~dp0ConEmuC.exe
set ConEmuC3=ConEmuC.exe
goto con_find
:con_find
set ConEmuPath=%ConEmuC1%
if exist "%ConEmuPath%" goto con_found
set ConEmuPath=%ConEmuC2%
if exist "%ConEmuPath%" goto con_found
set ConEmuPath=%ConEmuC3%
if exist "%ConEmuPath%" goto con_found
goto notfound

:con_found
rem Message moved to ConEmuC.exe
rem echo ConEmu autorun (c) Maximus5
rem echo Starting "%ConEmuPath%" in "/ATTACH /NOCMD" mode
call "%ConEmuPath%" /ATTACH /NOCMD
goto :EOF

:notfound
:notfound
Echo ConEmu not found! "%~dp0ConEmuC.exe"
goto :EOF
