@echo off


call "%~dp0lib_base.cmd"
call "%%~dp0lib_console"
set lib_path=call "%~dp0lib_path.cmd"

if "%~1" == "/h" (
    %lib_base% help "%~0"
) else if "%1" neq "" (
    call :%*
)

exit /b

:enhance_path
:::===============================================================================
:::enhance_path - Add a directory to the path env variable if required.
:::
:::include:
:::
:::  call "lib_path.cmd"
:::
:::usage:
:::
:::  %lib_path% enhance_path "[dir_path]" [append]
:::
:::required:
:::
:::  [dir_path] <in> Fully qualified directory path. Ex: "c:\bin"
:::
:::options:
:::
:::  append     <in> Append to the path env variable rather than pre-pend.
::B
:::
:::output:
:::
:::  path       <out> Sets the path env variable if required.
:::-------------------------------------------------------------------------------

    if "%~1" neq "" (
        set "add_path=%~1"
    ) else (
        %print_error% "You must specify a directory to add to the path!"
        exit 1
    )

    if "%~2" neq "" if /i "%~2" == "append" (
        set "position=%~2"
    ) else (
        set "position="
    )

    dir "%add_path%" | findstr -i "\.COM \.EXE \.BAT \.CMD \.PS1 \.VBS" >NUL
    if "%ERRORLEVEL%" == "0" (
        set "add_to_path=%add_path%"
    ) else (
        set "add_to_path="
    )

    if "%fast_init%" == "1" (
        if "%position%" == "append" (
            set "PATH=%PATH%;%add_to_path%"
        ) else (
            set "PATH=%add_to_path%;%PATH%"
        )
        goto :end_enhance_path
    ) else if "add_to_path" equ "" (
        goto :end_enhance_path
    )

    set found=0
    set "find_query=%add_to_path%"
    set "find_query=%find_query:\=\\%"
    set "find_query=%find_query: =\ %"
    set "OLD_PATH=%PATH%"

    setlocal enabledelayedexpansion
    if "!found!" == "0" (
        echo "!path!"|!WINDIR!\System32\findstr >nul /I /R /C:";!find_query!;"
        call :set_found
    )
    %print_debug%  :enhance_path "Env Var INSIDE PATH !find_query! - found=!found!"

    if /i "!position!" == "append" (
        if "!found!" == "0" (
            echo "!path!"|!WINDIR!\System32\findstr >nul /I /R /C:";!find_query!\"$"
            call :set_found
        )
        %print_debug%  :enhance_path "Env Var END PATH !find_query! - found=!found!"
    ) else (
        if "!found!" == "0" (
            echo "!path!"|!WINDIR!\System32\findstr >nul /I /R /C:"^\"!find_query!;"
            call :set_found
        )
        %print_debug%  :enhance_path "Env Var BEGIN PATH !find_query! - found=!found!"
    )
    endlocal & set found=%found%

    if "%found%" == "0" (
        if /i "%position%" == "append" (
            %print_debug% :enhance_path "Appending '%add_to_path%'"
            set "PATH=%PATH%;%add_to_path%"
        ) else (
            %print_debug% :enhance_path "Prepending '%add_to_path%'"
            set "PATH=%add_to_path%;%PATH%"
        )

        set found=1
    )

    :end_enhance_path
    set "PATH=%PATH:;;=;%"

    REM echo %path%|"C:\Users\dgames\cmder - dev\vendor\git-for-windows\usr\bin\wc" -c
    if "%fast_init%" == "1" exit /b

    if not "%OLD_PATH:~0,3000%" == "%OLD_PATH:~0,3001%" goto :toolong
    if not "%OLD_PATH%" == "%PATH%" goto :changed
    exit /b

    :toolong
        echo "%OLD_PATH%">"%temp%\cmder_lib_pathA"
        echo "%PATH%">"%temp%\cmder_lib_pathB"
        fc /b "%temp%\cmder_lib_pathA" "%temp%\cmder_lib_pathB" 2>nul 1>nul
        if errorlevel 1 ( del "%temp%\cmder_lib_pathA" & del "%temp%\cmder_lib_pathB" & goto :changed )
        del "%temp%\cmder_lib_pathA" & del "%temp%\cmder_lib_pathB"
        exit /b

    :changed
        %print_debug%  :enhance_path "END Env Var - PATH=%path%"
        %print_debug%  :enhance_path "Env Var %find_query% - found=%found%"
        exit /b

    exit /b


:set_found
    if "%ERRORLEVEL%" == "0" (
        set found=1
    )

    exit /b

:enhance_path_recursive
:::===============================================================================
:::enhance_path_recursive - Add a directory and subs to the path env variable if
:::                         required.
:::.
:::include:
:::.
:::  call "$0"
:::.
:::usage:
:::.
:::  call "%~DP0lib_path" enhance_path_recursive "[dir_path]" [max_depth] [append]
:::.
:::required:
:::.
:::  [dir_path] <in> Fully qualified directory path. Ex: "c:\bin"
:::.
:::options:
:::.
:::  [max_depth] <in> Max recursion depth.  Default: 1
:::.
:::  append      <in> Append instead to path env variable rather than pre-pend.
:::.
:::output:
:::.
:::  path       <out> Sets the path env variable if required.
:::-------------------------------------------------------------------------------
    if "%~1" neq "" (
        set "add_path=%~1"
    ) else (
        %print_error% "You must specify a directory to add to the path!"
        exit 1
    )

    set "depth=%~2"
    set "max_depth=%~3"

    if "%~4" neq "" if /i "%~4" == "append" (
        set "position=%~4"
    ) else (
        set "position="
    )

    dir "%add_path%" 2>NUL | findstr -i "\.COM \.EXE \.BAT \.CMD \.PS1 \.VBS" >NUL

    if "%ERRORLEVEL%" == "0" (
        set "add_to_path=%add_path%"
    ) else (
        set "add_to_path="
    )

    if "%fast_init%" == "1" (
        if "%add_to_path%" neq "" (
            call :enhance_path "%add_to_path%" %position%
        )
    )

    set "PATH=%PATH:;;=;%"
    if "%fast_init%" == "1" (
        exit /b
    )

    %print_debug%  :enhance_path_recursive "Env Var - add_path=%add_to_path%"
    %print_debug%  :enhance_path_recursive "Env Var - position=%position%"
    %print_debug%  :enhance_path_recursive "Env Var - depth=%depth%"
    %print_debug%  :enhance_path_recursive "Env Var - max_depth=%max_depth%"

    if %max_depth% gtr %depth% (
        if "%add_to_path%" neq "" (
            %print_debug% :enhance_path_recursive "Adding parent directory - '%add_to_path%'"
            call :enhance_path "%add_to_path%" %position%
        )
        call :set_depth
        call :loop_depth
    )

    set "PATH=%PATH%"

    exit /b

: set_depth
    set /a "depth=%depth%+1"
    exit /b

:loop_depth
    if %depth% == %max_depth% (
        exit /b
    )

    for /d %%i in ("%add_path%\*") do (
        %print_debug%  :enhance_path_recursive "Env Var BEFORE - depth=%depth%"
        %print_debug% :enhance_path_recursive "Found Subdirectory - '%%~fi'"
        call :enhance_path_recursive "%%~fi" %depth% %max_depth% %position%
        %print_debug%  :enhance_path_recursive "Env Var AFTER- depth=%depth%"
    )
    exit /b

