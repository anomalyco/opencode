@echo off

rem Below are the default Cmder session settings:
rem
rem See "%CMDER_ROOT%\README.md" for details on these settings.
rem
rem `Cmder.exe` Arguments:
rem ----------------------
rem 
rem `/c [cmder_user_cfg_root]
rem set cmder_user_bin=[cmder_user_cfg_root]\bin
rem set cmder_user_config=[cmder_user_cfg_root]\config
rem
rem `init.bat` Arguments
rem --------------------
rem
rem `/d`
rem debug_output=0
rem
rem `/v`
rem verbose_output=0
rem
rem `/f`
rem fast_init=0
rem
rem `/nix_tools`
rem nix_tools=1
rem
rem `/t`
rem time_init=0
rem
rem `/max_depth`
rem max_depth=1
rem
rem `/user_aliases`
rem user_aliases=
rem
rem `/git_install_root`
rem GIT_INSTALL_ROOT=
rem
rem `/home`
rem HOME=
rem
rem `/svn_ssh`
rem SVN_SSH=

echo Applying Cmder VSCode settings from '%~0'...

if defined CMDER_CONFIGURED (
    rem Set Cmder settings here for when VSCode is launched inside Cmder.
    set verbose_output=1
) else (
    rem Set Cmder settings here for when VSCode is launched from outside Cmder.
    set verbose_output=1
)

rem Set all required Cmder VSCode terminal environment settings above this line.
echo Applying Cmder VSCode settings is complete!
