@echo off

rem This example helper file may be used for showing
rem your current git branch and changes count in
rem the Far Manager prompt

rem Rename this file to 'git.cmd' and place somewhere in %PATH%


set TERM=msys

set check_br=NO
set git_fail=NO


rem If command may change working state - need check branch after...
for %%c in ("add","br","branch","checkout","co","commit","pull","push","rebase","stash") do if /I "%~1" == %%c set check_br=YES&goto cmd_checked
:cmd_checked


:run_git
setlocal
set ConEmuHooks=OFF
call "%~dp0..\bin\git" %*
if errorlevel 1 (
  endlocal
  goto fail
) else (
  endlocal
  goto done
)

:fail
set git_fail=YES

:done
if NOT %check_br%==YES goto :EOF

if %git_fail%==YES (
set gitbranch=^>
"%ConEmuBaseDir%\ConEmuC.exe" /export=CON gitbranch
) else (
call "%~dp0GitShowBranch.cmd"
)
