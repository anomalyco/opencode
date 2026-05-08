@echo off

rem Run this file in cmd.exe or tcc.exe to change
rem Title of console window.

rem Change cmd.exe title permanently to "This is my cmd"
rem   SetConTitle.cmd "This is my cmd"

rem To remove title "locking" just run this without args
rem   SetConTitle.cmd

rem Note!
rem "Inject ConEmuHk" and "ANSI X3.64" options
rem must be turned ON in ConEmu Settings!

rem set ESC=
call "%~dp0SetEscChar.cmd"

rem Next command will change title immediately (once)
rem Have not much use, because next time cmd prompt
rem appears, cmd.exe will revert title back
echo %ESC%]2;"%~1"%ESC%\

rem And this will change title each time cmd prompt appears
rem This will lock title to your desired value
prompt $e]2;"%~1"$e\$p$g
