@echo off

set CMDER_ROOT=%~dp0..\..\

if "%cmder_init%" == "1" (
    "%CMDER_ROOT%\vendor\clink\clink.bat" inject -q --profile "%CMDER_ROOT%\config" --scripts "%CMDER_ROOT%\vendor"
) else (
    set cmder_init=1
)

pushd "%CMDER_ROOT%"
call "%CMDER_ROOT%\vendor\init.bat" /f %*
popd
