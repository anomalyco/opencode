@rem You may use this batch-file to colorize output of compliers
@rem Tested with 'sed' from MinGW/MSys and Visual C++ build output

@rem Usage: TypeBuildErrors "FullPathToCompilerOutputLog"

@rem Usually current screen already contains compiler output
@rem Clear it for avoid dupes of non-colored and colored lines
@cls

@rem Optional "pre" setup of environment variables (PATH to sed.exe for example)
@if exist "%~dp0TypeBuildErrors_Vars.cmd" call "%~dp0TypeBuildErrors_Vars.cmd"

@rem Run colorization, "sed.exe" is required!
@type "%~1" | sed -e "s/.*: \bERR.*/[1;31;40m&[0m/i" -e "s/.*: FATAL ERROR.*/[1;31;40m&[0m/i" -e "s/.*: \bWARN.*/[1;36;40m&[0m/i" -e "s/.* [1-9][0-9]* error.*/[1;31;40m&[0m/i" -e "s/.* [1-9][0-9]* warning.*/[1;36;40m&[0m/i"
