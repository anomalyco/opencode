@echo off

call "%~dp0lib_base.cmd"
call "%%~dp0lib_console.cmd"
set lib_git=call "%~dp0lib_git.cmd"

if "%~1" == "/h" (
    %lib_base% help "%~0"
) else if "%1" neq "" (
    call :%*
)

exit /b

:read_version
:::===============================================================================
:::read_version - Get the git.exe version
:::.
:::include:
:::.
:::  call "lib_git.cmd"
:::.
:::usage:
:::.
:::  %lib_git% read_version "[dir_path]"
:::.
:::required:
:::.
:::  [GIT SCOPE]   <in> USER | VENDORED
:::  [GIT PATH]    <in> Fully qualified path to the Git command root.
:::.
:::output:
:::.
:::  GIT_VERSION_[GIT SCOPE] <out> Env variable containing Git semantic version string
:::-------------------------------------------------------------------------------

    :: clear the variables
    set GIT_VERSION_%~1=

    :: set the executable path
    set "git_executable=%~2\git.exe"
    %print_debug% :read_version "Env Var - git_executable=%git_executable%"

    :: check if the executable actually exists
    if not exist "%git_executable%" (
        %print_debug% :read_version "%git_executable% does not exist."
        exit /b -255
    )

    :: get the git version in the provided directory
    "%git_executable%" --version > "%temp%\git_version.txt"
    setlocal enabledelayedexpansion
    for /F "tokens=1,2,3 usebackq" %%A in (`type "%temp%\git_version.txt" 2^>nul`) do (
        if /i "%%A %%B" == "git version" (
            set "GIT_VERSION=%%C"
        ) else (
            echo "'git --version' returned an improper version string!"
            %print_debug% :read_version "returned string: '%%A %%B %%C' by executable path: %git_executable%"
            pause
            exit /b
        )
    )
    endlocal & set "GIT_VERSION_%~1=%GIT_VERSION%" & %print_debug% :read_version "Env Var - GIT_VERSION_%~1=%GIT_VERSION%"

    exit /b

:parse_version
:::===============================================================================
:::parse_version - Parse semantic version string 'x.x.x.x' and return the pieces
:::.
:::include:
:::.
:::  call "$0"
:::.
:::usage:
:::.
:::  %lib_git% parse_version "[VERSION]"
:::.
:::required:
:::.
:::  [SCOPE]     <in> USER | VENDORED
:::  [VERSION]   <in> Semantic version String. Ex: 1.2.3.4
:::.
:::output:
:::.
:::  [SCOPE]_MAJOR <out> Scoped Major version.
:::  [SCOPE]_MINOR <out> Scoped Minor version.
:::  [SCOPE]_PATCH <out> Scoped Patch version.
:::  [SCOPE]_BUILD <out> Scoped Build version.
:::-------------------------------------------------------------------------------

    :: process a `x.x.x.xxxx.x` formatted string
    %print_debug% :parse_version "ARGV[1]=%~1, ARGV[2]=%~2"

    setlocal enabledelayedexpansion
    for /F "tokens=1-3* delims=.,-" %%A in ("%2") do (
        set "%~1_MAJOR=%%A"
        set "%~1_MINOR=%%B"
        set "%~1_PATCH=%%C"
        set "%~1_BUILD=%%D"
    )

    REM endlocal & set "%~1_MAJOR=!%~1_MAJOR!" & set "%~1_MINOR=!%~1_MINOR!" & set "%~1_PATCH=!%~1_PATCH!" & set "%~1_BUILD=!%~1_BUILD!"
    if "%~1" == "VENDORED" (
        endlocal & set "%~1_MAJOR=%VENDORED_MAJOR%" & set "%~1_MINOR=%VENDORED_MINOR%" & set "%~1_PATCH=%VENDORED_PATCH%" & set "%~1_BUILD=%VENDORED_BUILD%"
    ) else (
        endlocal & set "%~1_MAJOR=%USER_MAJOR%" & set "%~1_MINOR=%USER_MINOR%" & set "%~1_PATCH=%USER_PATCH%" & set "%~1_BUILD=%USER_BUILD%"
    )

    exit /b

:endlocal_set_git_version

:validate_version
:::===============================================================================
:::validate_version - Validate semantic version string 'x.x.x.x'.
:::.
:::include:
:::.
:::  call "$0"
:::.
:::usage:
:::.
:::  %lib_git% validate_version [SCOPE] [VERSION]
:::.
:::required:
:::.
:::  [SCOPE]     <in> Example:  USER | VENDORED
:::  [VERSION]   <in> Semantic version String. Ex: 1.2.3.4
:::-------------------------------------------------------------------------------

    :: now parse the version information into the corresponding variables
    %print_debug% :validate_version "ARGV[1]=%~1, ARGV[2]=%~2"

    call :parse_version %~1 %~2

    :: ... and maybe display it, for debugging purposes.
    REM %print_debug% :validate_version "Found Git Version for %~1: !%~1_MAJOR!.!%~1_MINOR!.!%~1_PATCH!.!%~1_BUILD!"
    if "%~1" == "VENDORED" (
        %print_debug% :validate_version "Found Git Version for %~1: %VENDORED_MAJOR%.%VENDORED_MINOR%.%VENDORED_PATCH%.%VENDORED_BUILD%"
    ) else (
        %print_debug% :validate_version "Found Git Version for %~1: %USER_MAJOR%.%USER_MINOR%.%USER_PATCH%.%USER_BUILD%"
    )
    exit /b

:compare_versions
:::===============================================================================
:::compare_version - Compare semantic versions return latest version.
:::.
:::include:
:::.
:::  call "$0"
:::.
:::usage:
:::.
:::  %lib_git% validate_version [SCOPE1] [SCOPE2]
:::.
:::required:
:::.
:::  [SCOPE1]    <in> Example: USER
:::  [SCOPE2]    <in> Example: VENDOR
:::-------------------------------------------------------------------------------

    :: checks all major, minor, patch and build variables for the given arguments.
    :: whichever binary that has the most recent version will be used based on the return code.

    %print_debug% ":compare_versions" "Comparing:"
    %print_debug% ":compare_versions" "%~1: %USER_MAJOR%.%USER_MINOR%.%USER_PATCH%.%USER_BUILD%"
    %print_debug% ":compare_versions" "%~2: %VENDORED_MAJOR%.%VENDORED_MINOR%.%VENDORED_PATCH%.%VENDORED_BUILD%"

    setlocal enabledelayedexpansion
    if !%~1_MAJOR! GTR !%~2_MAJOR! (endlocal & exit /b  1)
    if !%~1_MAJOR! LSS !%~2_MAJOR! (endlocal & exit /b -1)

    if !%~1_MINOR! GTR !%~2_MINOR! (endlocal & exit /b  1)
    if !%~1_MINOR! LSS !%~2_MINOR! (endlocal & exit /b -1)

    if !%~1_PATCH! GTR !%~2_PATCH! (endlocal & exit /b  1)
    if !%~1_PATCH! LSS !%~2_PATCH! (endlocal & exit /b -1)

    if !%~1_BUILD! GTR !%~2_BUILD! (endlocal & exit /b  1)
    if !%~1_BUILD! LSS !%~2_BUILD! (endlocal & exit /b -1)

    :: looks like we have the same versions.
    endlocal & exit /b 0

:::===============================================================================
:::is_git_shim
:::.
:::include:
:::.
:::  call "$0"
:::.
:::usage:
:::.
:::  %lib_git% is_git_shim [filepath]
:::.
:::required:
:::.
:::  [filepath]    <in>
:::-------------------------------------------------------------------------------

:is_git_shim
    pushd "%~1"
    :: check if there's shim - and if yes follow the path
    setlocal enabledelayedexpansion
    if exist git.shim (
        for /F "tokens=2 delims== " %%I in (git.shim) do (
            pushd %%~dpI
            set "test_dir=!CD!"
            popd
        )
    ) else (
        set "test_dir=!CD!"
    )
    endlocal & set "test_dir=%test_dir%"

    popd
    exit /b

:::===============================================================================
:::compare_git_versions
:::.
:::include:
:::.
:::  call "$0"
:::.
:::usage:
:::.
:::  %lib_git% compare_git_versions
:::-------------------------------------------------------------------------------

:compare_git_versions
    setlocal enabledelayedexpansion
    if ERRORLEVEL 0 (
        :: compare the user git version against the vendored version
        %lib_git% compare_versions USER VENDORED
        set result=!ERRORLEVEL!
        %print_debug% ":compare_git_versions" "campare versions_result: !result!"

        :: use the user provided git if its version is greater than, or equal to the vendored git
        if !result! geq 0 (
            if exist "!test_dir:~0,-4!\cmd\git.exe" (
                set "GIT_INSTALL_ROOT=!test_dir:~0,-4!"
            ) else (
                set "GIT_INSTALL_ROOT=!test_dir!"
            )
        ) else (
            %print_debug% ":compare_git_versions" "Found old !GIT_VERSION_USER! in !test_dir!, but not using..."
        )
    ) else (
        :: compare the user git version against the vendored version
        :: if the user provided git executable is not found
        IF ERRORLEVEL -255 IF NOT ERRORLEVEL -254 (
        :: if not exist "%git_executable%" (
            %print_debug% ":compare_git_versions" "No git at "%git_executable%" found."
            set test_dir=
        )
    )
    endlocal && set "GIT_INSTALL_ROOT=%GIT_INSTALL_ROOT%" && set test_dir=

    exit /b

:::===============================================================================
:::get_user_git_version - get the version information for the user provided git binary
:::.
:::include:
:::.
:::  call "$0"
:::.
:::usage:
:::.
:::  %lib_git% get_user_git_version
:::-------------------------------------------------------------------------------

:get_user_git_version
    :: get the version information for the user provided git binary
    %lib_git% read_version USER "%test_dir%" 2>nul
    %print_debug% ":get_user_git_version" "get_user_git_version GIT_VERSION_USER: %GIT_VERSION_USER%"
    %lib_git% validate_version USER %GIT_VERSION_USER%
    exit  /b

