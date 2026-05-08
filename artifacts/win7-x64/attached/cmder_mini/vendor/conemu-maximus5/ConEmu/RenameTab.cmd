@echo off

rem Run this file in cmd.exe or tcc.exe to change
rem Tab title in ConEmu. Same as "Rename tab" in GUI.

rem Note!
rem "Inject ConEmuHk" and "ANSI X3.64" options
rem must be turned ON in ConEmu Settings!

echo ]9;3;"%~1"\
