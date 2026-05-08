@echo off

set lib_base=call "%~dp0lib_base.cmd"

if "%~1" == "/h" (
    %lib_base% help "%~0"
) else if "%1" neq "" (
    call :%*
)

exit /b

:help
:::===============================================================================
:::show_subs - shows all sub routines in a .bat/.cmd file with documentation
:::.
:::include:
:::.
:::       call "lib_base.cmd"
:::.
:::usage:
:::.
:::       %lib_base% show_subs "file"
:::.
:::options:
:::.
:::       file <in> full path to file containing lib_routines to display
:::.
:::-------------------------------------------------------------------------------
    for /f "tokens=* delims=:" %%a in ('type "%~1" ^| %WINDIR%\System32\findstr /i /r "^:::"') do (
        rem echo a="%%a"

        if "%%a"=="." (
            echo.
        ) else if /i "%%a" == "usage" (
            echo %%a:
        ) else if /i "%%a" == "options" (
            echo %%a:
        ) else if not "%%a" == "" (
            echo %%a
        )
    )

    pause
    exit /b

:cmder_shell
:::===============================================================================
:::show_subs - shows all sub routines in a .bat/.cmd file with documentation
:::.
:::include:
:::.
:::       call "lib_base.cmd"
:::.
:::usage:
:::.
:::       %lib_base% cmder_shell
:::.
:::options:
:::.
:::       file <in> full path to file containing lib_routines to display
:::.
:::-------------------------------------------------------------------------------
    call :detect_comspec %ComSpec%
    exit /b

:detect_comspec
    set CMDER_SHELL=%~n1
    if not defined CMDER_CLINK (
        set CMDER_CLINK=1
    )
    if not defined CMDER_ALIASES (
        set CMDER_ALIASES=1
    )
    exit /b

:update_legacy_aliases
    type "%user_aliases%" | %WINDIR%\System32\findstr /i ";= Add aliases below here" >nul
    if "%errorlevel%" == "1" (
        echo Creating initial user_aliases store in "%user_aliases%"...
        if defined CMDER_USER_CONFIG (
            copy "%user_aliases%" "%user_aliases%.old_format"
            copy "%CMDER_ROOT%\vendor\user_aliases.cmd.default" "%user_aliases%"
        ) else (
            copy "%user_aliases%" "%user_aliases%.old_format"
            copy "%CMDER_ROOT%\vendor\user_aliases.cmd.default" "%user_aliases%"
        )
    )
    exit /b
