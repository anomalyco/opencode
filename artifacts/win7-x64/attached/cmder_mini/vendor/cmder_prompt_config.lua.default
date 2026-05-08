-- All of the below was 'borrowed' from https://github.com/AmrEldib/cmder-powerline-prompt

--- REQUIRED. config_prompt_type is whether the displayed prompt is the full path or only the folder name
 -- Use:
 -- "full" for full path like C:\Windows\System32
 -- "folder" for folder name only like System32
 -- default is full
prompt_type = "full"

--- REQUIRED. config_prompt_useHomeSymbol is whether to show ~ instead of the full path to the user's home folder
 -- Use true or false
 -- default is false
prompt_useHomeSymbol = false

-- Symbols
-- REQUIRED. Prompt displayed instead of user's home folder e.g. C:\Users\username
 -- default is '~'
prompt_homeSymbol = "~"

-- REQUIRED. Symbol displayed in the new line below the prompt.
 -- default is 'λ'
prompt_lambSymbol = "λ"

-- REQUIRED. Adds [user]@[host] to the beginning of the prompt like bash
 -- default is false
prompt_useUserAtHost = false

-- REQUIRED. If true prompt is a single line instead of default two line prompt.
 -- default is false
prompt_singleLine = false

-- OPTIONAL. If true then Cmder includes git, mercurial, and subversion status in the prompt.
 -- default is true
prompt_includeVersionControl = true

-- OPTIONAL. If true then always ignore the cmder.status and cmder.cmdstatus git config settings and run the git prompt commands in the background.
 -- default is false
 -- NOTE: This only takes effect if using Clink v1.2.10 or higher.
prompt_overrideGitStatusOptIn = false

-- OPTIONAL. If true then always ignore the cmder.status and cmder.cmdstatus svn config settings and run the svn prompt commands in the background.
 -- default is false
 -- NOTE: This only takes effect if using Clink v1.2.10 or higher.
prompt_overrideSvnStatusOptIn = false

-- Prompt Attributes
--
-- Colors: https://github.com/cmderdev/cmder/wiki/Customization#list-of-colors
-- Effects: https://github.com/cmderdev/cmder/wiki/Customization#list-of-effects
--
-- Green:      "\x1b[1;33;49m"
-- Yellow:     "\x1b[1;32;49m"
-- Light Grey: "\x1b[1;30;49m"

-- Prompt Element Colors
uah_color = "\x1b[1;33;49m" -- Green = uah = [user]@[hostname]
cwd_color = "\x1b[1;32;49m" -- Yellow cwd = Current Working Directory
lamb_color = "\x1b[1;30;49m" -- Light Grey = Lambda Color
clean_color = "\x1b[37;1m"
dirty_color = "\x1b[33;3m" -- Yellow, Italic
conflict_color = "\x1b[31;1m" -- Red, Bold
unknown_color = "\x1b[37;1m" -- White = No VCS Status Branch Color
