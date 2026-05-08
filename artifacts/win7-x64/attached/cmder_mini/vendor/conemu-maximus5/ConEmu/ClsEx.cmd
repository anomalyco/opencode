@echo off

rem You want to get your cmd.exe prompt bottom aligned?
rem On ConEmu startup and after "cls"?
rem It is possible, run this file as your shell:
rem cmd.exe /k ClsEx.cmd

rem Need to install alias?
if NOT "%~1"=="/CLS" (
doskey cls="%~0" /CLS
title cmd
)

rem Do clear screen and goto bottom
set ESC=
echo %ESC%[2J%ESC%[9999E
