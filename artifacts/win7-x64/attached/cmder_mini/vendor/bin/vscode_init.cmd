@echo off

rem Find root dir

if not defined CMDER_ROOT (
    for /f "delims=" %%i in ("%~dp0\..\..") do (
        set "cmder_root=%%~fi"
    )
)

if defined cmder_user_bin (
    set CMDER_VSCODE_INIT_ARGS=%cmder_user_bin%\vscode_init_args.cmd
) else (
    set CMDER_VSCODE_INIT_ARGS=%CMDER_ROOT%\bin\vscode_init_args.cmd
)

if not exist "%CMDER_VSCODE_INIT_ARGS%" (
    echo Creating initial "%CMDER_VSCODE_INIT_ARGS%"...
    copy "%CMDER_ROOT%\vendor\bin\vscode_init_args.cmd.default" "%CMDER_VSCODE_INIT_ARGS%"
) else (
    call "%CMDER_VSCODE_INIT_ARGS%"
)

IF [%1] == [] (
    REM -- manually opened console (Ctrl + Shift + `) --
    CALL "%~dp0..\init.bat"
) ELSE (
    REM -- task --
    CALL cmd %*
    exit
)
