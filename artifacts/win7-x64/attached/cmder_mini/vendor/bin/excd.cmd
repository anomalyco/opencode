@if "%~1"=="/?" (@cd %*)
@set excd=%*
@set excd=%excd:"=%
@if "%excd:~0,1%"=="~" (@set excd=%userprofile%\%excd:~1%)
@if not "%~1"=="/d" (@set excd_param="/d") else (@set excd_param=)
@cd %excd_param% "%excd%"
