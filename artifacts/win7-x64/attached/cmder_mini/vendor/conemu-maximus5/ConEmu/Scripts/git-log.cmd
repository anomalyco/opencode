@echo off

rem If your git log containing UTF-8 or national characters is messed,
rem just set in the Settings/Environment proper `LANG` variable, examples:
rem set LANG=en_US.UTF-8
rem set LANG=ru_RU.utf8
rem set LANG=ru_RU.CP1251

rem Check if we can output colors to PTY or not
ConEmuC -isredirect

if errorlevel 2 goto is_con

rem Plain text mode
git log --graph "--date=format:%%y%%m%%d:%%H%%M" "--pretty=format:%%h%%d %%an %%ad  %%s" %*
goto :EOF

:is_con
rem Colored mode
git log --graph "--date=format:%%y%%m%%d:%%H%%M" "--pretty=format:%%C(auto)%%h%%d %%C(bold blue)%%an %%Cgreen%%ad  %%Creset%%s" %*
goto :EOF
