@echo off

rem Usage example for your batch files
rem   call IsConEmu.cmd > nul
rem  if errorlevel 1 (
rem   ... Your batch started out of ConEmu, simple command prompt
rem  ) else (
rem   ... Your batch is running in active ConEmu window
rem  )


rem Don't change any env.variables outside of this batch
setlocal

rem For ANSI example you may set "YES" instead of "NO"
set UseAnsi=NO
if "%UseAnsi%"=="YES" goto TryAnsi

rem Preferable way - use GuiMacro
if exist "%~dp0ConEmuC.exe" (

call "%~dp0ConEmuC.exe" /GuiMacro IsConEmu > nul
if errorlevel 1 goto showresult
set ConEmuMacroResult=Yes
goto showresult

) else if exist "%~dp0ConEmuC64.exe" (

call "%~dp0ConEmuC64.exe" /GuiMacro IsConEmu > nul
if errorlevel 1 goto showresult
set ConEmuMacroResult=Yes
goto showresult

) else (

echo "%~dp0ConEmuC.exe" not found!
exit /b 2
goto :EOF

)


rem Ok, try ANSI
set ConEmuMacroResult=
set ESC=

:TryAnsi
rem Check if ANSI is enabled
if not "%ConEmuANSI%"=="ON" (
echo ConEmu ANSI X3.64 was not enabled!
exit /b 2
goto :EOF
)

echo %ESC%[s%ESC%]9;6;"IsConEmu"%ESC%\%ESC%[u%ESC%[A

:showresult
if "%ConEmuMacroResult%"=="Yes" (
echo ConEmu found!
exit /b 0
) else (
echo ConEmu NOT found!
exit /b 1
)
