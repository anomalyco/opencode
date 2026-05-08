rem !!! Sample user specific settings that will persist in upgrade !!!
rem !!! Save as "%USERPROFILE%\.conemu\CmdInit.cmd" to activate    !!!

rem echo Loading ConEmu user settings...

rem Instead of turning on UTF-8 codepage here,
rem it's recommended to configure it on the Environment:
rem https://conemu.github.io/en/SettingsEnvironment.html
rem chcp 65001

rem {Shell type} {path} right-angle-quote over two lines and no hostname:
rem		 CMD C:\Users\Me\Code
rem		 »
set PROMPT=$E[m$E[32mCMD$E\$S$E[92m$P$E[90m$_$E[90m»$E[m$S$E]9;12$E\
