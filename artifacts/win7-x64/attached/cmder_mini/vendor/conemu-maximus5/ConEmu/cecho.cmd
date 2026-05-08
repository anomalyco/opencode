@if "%~1" == "/?" goto help
@if "%~1" == "-?" goto help

:cecho

@if NOT "%ConEmuANSI%"=="ON" (
@echo %~1
@goto :EOF
)

@setlocal

@call "%~dp0SetEscChar.cmd"

@if /I "%~1" == "/red" (
@set clr=1;31;40m
@shift /1
) else if /I "%~1" == "/green" (
@set clr=1;32;40m
@shift /1
) else if /I "%~1" == "/yellow" (
@set clr=1;33;40m
@shift /1
) else if /I "%~1" == "/blue" (
@set clr=1;34;40m
@shift /1
) else if /I "%~1" == "/magenta" (
@set clr=1;35;40m
@shift /1
) else if /I "%~1" == "/cyan" (
@set clr=1;36;40m
@shift /1
) else if /I "%~1" == "/white" (
@set clr=1;37;40m
@shift /1
) else (
@set clr=1;31;40m
)

@echo %ESC%[%clr%%~1%ESC%[0m
@goto :EOF

:help
@call :cecho /white "Usage examples:"
@call :cecho /red     "  cecho [/red]   "YourText""
@call :cecho /green   "  cecho /green   "YourText""
@call :cecho /yellow  "  cecho /yellow  "YourText""
@call :cecho /blue    "  cecho /blue    "YourText""
@call :cecho /magenta "  cecho /magenta "YourText""
@call :cecho /cyan    "  cecho /cyan    "YourText""
@call :cecho /white   "  cecho /white   "YourText""
