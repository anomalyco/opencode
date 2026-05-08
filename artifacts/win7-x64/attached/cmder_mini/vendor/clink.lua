-- default script for clink, called by init.bat when injecting clink

-- !!! THIS FILE IS OVERWRITTEN WHEN CMDER IS UPDATED
-- !!! Use "%CMDER_ROOT%\config\<whatever>.lua" to add your lua startup scripts

-- luacheck: globals CMDER_SESSION
-- luacheck: globals uah_color cwd_color lamb_color clean_color dirty_color conflict_color unknown_color
-- luacheck: globals prompt_homeSymbol prompt_lambSymbol prompt_type prompt_useHomeSymbol prompt_useUserAtHost
-- luacheck: globals prompt_singleLine prompt_includeVersionControl
-- luacheck: globals prompt_overrideGitStatusOptIn prompt_overrideSvnStatusOptIn
-- luacheck: globals clink io.popenyield os.isdir settings.get

-- At first, load the original clink.lua file
-- this is needed as we set the script path to this dir and therefore the original
-- clink.lua is not loaded.
local clink_lua_file = clink.get_env('CMDER_ROOT')..'\\vendor\\clink\\clink.lua'
dofile(clink_lua_file)

-- now add our own things...


local function get_uah_color()
    return uah_color or "\x1b[1;33;49m" -- Green = uah = [user]@[hostname]
end

local function get_cwd_color()
    return cwd_color or "\x1b[1;32;49m" -- Yellow cwd = Current Working Directory
end

local function get_lamb_color()
    return lamb_color or "\x1b[1;30;49m" -- Light Grey = Lambda Color
end


local function get_clean_color()
    return clean_color or "\x1b[37;1m" -- White, Bold
end


local function get_dirty_color()
    return dirty_color or "\x1b[33;3m" -- Yellow, Italic
end


local function get_conflict_color()
    return conflict_color or "\x1b[31;1m" -- Red, Bold
end

local function get_unknown_color()
    return unknown_color or "\x1b[37;1m" -- White, Bold
end

---
-- Escapes special characters in a string.gsub `find` parameter, so that it
-- can be matched as a literal plain text string, i.e. disable Lua pattern
-- matching.  See "Patterns" (https://www.lua.org/manual/5.2/manual.html#6.4.1).
-- @param {string} text Text to escape
-- @returns {string} Escaped text
---
local function escape_gsub_find_arg(text)
    return text and text:gsub("([-+*?.%%()%[%]$^])", "%%%1") or ""
end

---
-- Escapes special characters in a string.gsub `replace` parameter, so that it
-- can be replaced as a literal plain text string, i.e. disable Lua pattern
-- matching.  See "Patterns" (https://www.lua.org/manual/5.2/manual.html#6.4.1).
-- @param {string} text Text to escape
-- @returns {string} Escaped text
---
local function escape_gsub_replace_arg(text)
    return text and text:gsub("%%", "%%%%") or ""
end

---
-- Perform string.sub, but disable Lua pattern matching and just treat both
-- the `find` and `replace` parameters as a literal plain text replacement.
-- @param {string} str Text in which to perform find and replace
-- @param {string} find Text to find (plain text; not a Lua pattern)
-- @param {string} replace Replacement text (plain text; not a Lua pattern)
-- @returns {string} Copy of the input `str` with `find` replaced by `replace`
---
local function gsub_plain(str, find, replace)
    return string.gsub(str, escape_gsub_find_arg(find), escape_gsub_replace_arg(replace))
end

-- Extracts only the folder name from the input Path
-- Ex: Input C:\Windows\System32 returns System32
---
local function get_folder_name(path)
    local reversePath = string.reverse(path)
    local slashIndex = string.find(reversePath, "\\")
    return string.sub(path, string.len(path) - slashIndex + 2)
end


---
-- Forward/backward compatibility for Clink asynchronous prompt filtering.
-- With Clink v1.2.10 and higher this lets git status run in the background and
-- refresh the prompt when it finishes, to eliminate waits in large git repos.
---
local io_popenyield
local clink_promptcoroutine
local cached_info = {}
if clink.promptcoroutine and io.popenyield then
    io_popenyield = io.popenyield
    clink_promptcoroutine = clink.promptcoroutine
else
    io_popenyield = io.popen
    clink_promptcoroutine = function (func)
        return func(false)
    end
end


---
-- Global variable so other Lua scripts can detect whether they're in a Cmder
-- shell session.
---
CMDER_SESSION = true


---
-- Setting the prompt in clink means that commands which rewrite the prompt do
-- not destroy our own prompt. It also means that started cmds (or batch files
-- which echo) don't get the ugly '{lamb}' shown.
---
local function set_prompt_filter()
    -- get_cwd() is differently encoded than the clink.prompt.value, so everything other than
    -- pure ASCII will get garbled. So try to parse the current directory from the original prompt
    -- and only if that doesn't work, use get_cwd() directly.
    -- The matching relies on the default prompt which ends in X:\PATH\PATH>
    -- (no network path possible here!)
    local old_prompt = clink.prompt.value
    local cwd = old_prompt:match('.*(.:[^>]*)>')
    if cwd == nil then cwd = clink.get_cwd() end

    -- environment systems like pythons virtualenv change the PROMPT and usually
    -- set some variable. But the variables are differently named and we would never
    -- get them all, so try to parse the env name out of the PROMPT.
    -- envs are usually put in round or square parentheses and before the old prompt
    local env = old_prompt:match('.*%(([^%)]+)%).+:')
    -- also check for square brackets
    if env == nil then env = old_prompt:match('.*%[([^%]]+)%].+:') end

    -- Much of the below was 'borrowed' from https://github.com/AmrEldib/cmder-powerline-prompt
    -- Symbol displayed for the home dir in the prompt.
    if not prompt_homeSymbol then
        prompt_homeSymbol = "~"
    end

    -- Symbol displayed in the new line below the prompt.
    if not prompt_lambSymbol then
        prompt_lambSymbol = "λ"
    end

    if not prompt_type then
        prompt_type = "full"
    end

    if prompt_useHomeSymbol == nil then
        prompt_useHomeSymbol = false
    end

    if prompt_useUserAtHost == nil then
        prompt_useUserAtHost = false
    end

    if prompt_singleLine == nil then
        prompt_singleLine = false
    end

    if prompt_includeVersionControl == nil then
        prompt_includeVersionControl = true
    end

    if prompt_type == 'folder' then
        cwd = get_folder_name(cwd)
    end

    if prompt_useHomeSymbol and string.find(cwd, clink.get_env("HOME")) then
        cwd = gsub_plain(cwd, clink.get_env("HOME"), prompt_homeSymbol)
    end

    local uah = ''
    if prompt_useUserAtHost then
        uah = clink.get_env("USERNAME") .. "@" .. clink.get_env("COMPUTERNAME") .. ' '
    end

    local cr = "\n"
    if prompt_singleLine then
        cr = ' '
    end

    cr = "\x1b[0m" .. cr

    if env ~= nil then env = "("..env..") " else env = "" end

    if uah ~= '' then uah = get_uah_color() .. uah end
    if cwd ~= '' then cwd = get_cwd_color() .. cwd end

    local version_control = prompt_includeVersionControl and "{git}{hg}{svn}" or ""

    local prompt = "{uah}{cwd}" .. version_control .. cr .. get_lamb_color() .. "{env}{lamb}\x1b[0m "
    prompt = gsub_plain(prompt, "{uah}", uah)
    prompt = gsub_plain(prompt, "{cwd}", cwd)
    prompt = gsub_plain(prompt, "{env}", env)
    clink.prompt.value = gsub_plain(prompt, "{lamb}", prompt_lambSymbol)
end

local function percent_prompt_filter()
    clink.prompt.value = gsub_plain(clink.prompt.value, "{percent}", "%")
end

---
-- Resolves closest directory location for specified directory.
-- Navigates subsequently up one level and tries to find specified directory
-- @param  {string} path    Path to directory will be checked. If not provided
--                          current directory will be used
-- @param  {string} dirname Directory name to search for
-- @return {string} Path to specified directory or nil if such dir not found
local function get_dir_contains(path, dirname)

    -- return parent path for specified entry (either file or directory)
    local function pathname(path) -- luacheck: ignore 432
        local prefix = ""
        local i = path:find("[\\/:][^\\/:]*$")
        if i then
            prefix = path:sub(1, i-1)
        end
        return prefix
    end

    -- Navigates up one level
    local function up_one_level(path) -- luacheck: ignore 432
        if path == nil then path = '.' end
        if path == '.' then path = clink.get_cwd() end
        return pathname(path)
    end

    -- Checks if provided directory contains git directory
    local function has_specified_dir(path, specified_dir) -- luacheck: ignore 432
        if path == nil then path = '.' end
        local found_dirs = clink.find_dirs(path..'/'..specified_dir)
        if #found_dirs > 0 then return true end
        return false
    end

    -- Set default path to current directory
    if path == nil then path = '.' end

    -- If we're already have .git directory here, then return current path
    if has_specified_dir(path, dirname) then
        return path..'/'..dirname
    else
        -- Otherwise go up one level and make a recursive call
        local parent_path = up_one_level(path)
        if parent_path == path then
            return nil
        else
            return get_dir_contains(parent_path, dirname)
        end
    end
end

-- adapted from from clink-completions' git.lua
local function get_git_dir(path)

    -- return parent path for specified entry (either file or directory)
    local function pathname(path) -- luacheck: ignore 432
        local prefix = ""
        local i = path:find("[\\/:][^\\/:]*$")
        if i then
            prefix = path:sub(1, i-1)
        end

        return prefix
    end

    -- Checks if provided directory contains git directory
    local function has_git_dir(dir)
        return clink.is_dir(dir..'/.git') and dir..'/.git'
    end

    local function has_git_file(dir)
        local gitfile = io.open(dir..'/.git')
        if not gitfile then return false end

        local line = gitfile:read() or ''
        local git_dir = line:match('gitdir: (.*)')
        gitfile:close()

        if os.isdir then -- only available in Clink v1.0.0 and higher
            if git_dir and os.isdir(git_dir) then
                return git_dir
            end
        end

        return git_dir and dir..'/'..git_dir
    end

    -- Set default path to current directory
    if not path or path == '.' then path = clink.get_cwd() end

    -- Calculate parent path now otherwise we won't be
    -- able to do that inside of logical operator
    local parent_path = pathname(path)

    return has_git_dir(path)
        or has_git_file(path)
        -- Otherwise go up one level and make a recursive call
        or (parent_path ~= path and get_git_dir(parent_path) or nil)
end

local function get_hg_dir(path)
    return get_dir_contains(path, '.hg')
end

local function get_svn_dir(path)
    return get_dir_contains(path, '.svn')
end

---
-- Find out current branch
-- @return {nil|git branch name}
---
local function get_git_branch(git_dir)
    git_dir = git_dir or get_git_dir()

    -- If git directory not found then we're probably outside of repo
    -- or something went wrong. The same is when head_file is nil
    local head_file = git_dir and io.open(git_dir..'/HEAD')
    if not head_file then return end

    local HEAD = head_file:read()
    head_file:close()

    -- If HEAD is missing, something is wrong.
    if not HEAD then return end

    -- if HEAD matches branch expression, then we're on named branch
    -- otherwise it is a detached commit
    local branch_name = HEAD:match('ref: refs/heads/(.+)')

    return branch_name or 'HEAD detached at '..HEAD:sub(1, 7)
end

---
-- Find out current branch information
-- @return {false|mercurial branch information}
---
local function get_hg_branch()
    -- Return the branch information. The default is to get just the
    -- branch name, but you could e.g. use the "hg-prompt" extension to
    -- get more information, such as any applied mq patches. Here's an
    -- example of that:
    -- local cmd = "hg prompt \"{branch}{status}{|{patch}}{update}\""
    local cmd = "hg branch 2>nul"
    local file = io.popen(cmd)
    if not file then
        return false
    end

    for line in file:lines() do
        local m = line:match("(.+)$")
        if m then
            file:close()
            return m
        end
    end
    file:close()

    return false
end

---
-- Find out current branch
-- @return {false|svn branch name}
---
local function get_svn_branch()
    local file = io_popenyield("svn info 2>nul")
    if not file then
        return false
    end

    for line in file:lines() do
        local m = line:match("^Relative URL:")
        if m then
            file:close()
            return line:sub(line:find("/")+1,line:len())
        end
    end
    file:close()

    return false
end

---
-- Get the status and conflict status of working dir
-- @return {bool <status>, bool <is_conflict>}
---
local function get_git_status()
    local file = io_popenyield("git --no-optional-locks status --porcelain 2>nul")
    if not file then
        return {}
    end

    local conflict_found = false
    local is_status = true
    for line in file:lines() do
        local code = line:sub(1, 2)
        -- print (string.format("code: %s, line: %s", code, line))
        if code == "DD" or code == "AU" or code == "UD" or code == "UA" or code == "DU" or code == "AA" or code == "UU" then -- luacheck: no max line length
            is_status = false
            conflict_found = true
            break
        -- unversioned files are ignored, comment out 'code ~= "!!"' to unignore them
        elseif code ~= "!!" and code ~= "??" then
            is_status = false
        end
    end
    file:close()

    return { status = is_status, conflict = conflict_found }
end

---
-- Get the status of working dir
-- @return {bool}
---
local function get_svn_status()
    local file = io_popenyield("svn status -q")
    if not file then
        return { error = true }
    end

    for line in file:lines() do -- luacheck: ignore 512, no unused
        file:close()
        return { clean = false }
    end
    file:close()

    return { clean = true }
end

---
-- Get the status of working dir
-- @return {bool}
---
local last_git_status_time = nil
local last_git_status_setting = true
local function get_git_status_setting()
    local time = os.clock()
    local last_time = last_git_status_time
    last_git_status_time = time
    if last_time and time >= 0 and time - last_time < 10 then
        return last_git_status_setting
    end

    -- When async prompt filtering is available, check the
    -- prompt_overrideGitStatusOptIn config setting for whether to ignore the
    -- cmder.status and cmder.cmdstatus git config opt-in settings.
    if clink.promptcoroutine and io.popenyield and settings.get("prompt.async") then
        if prompt_overrideGitStatusOptIn then
            last_git_status_setting = true
            return true
        end
    end

    local gitStatusConfig = io_popenyield("git --no-pager config cmder.status 2>nul")
    if gitStatusConfig then
        for line in gitStatusConfig:lines() do
            if string.match(line, 'false') then
                gitStatusConfig:close()
                last_git_status_setting = false
                return false
            end
        end
        gitStatusConfig:close()
    end

    local gitCmdStatusConfig = io_popenyield("git --no-pager config cmder.cmdstatus 2>nul")
    if gitCmdStatusConfig then
        for line in gitCmdStatusConfig:lines() do
            if string.match(line, 'false') then
                gitCmdStatusConfig:close()
                last_git_status_setting = false
                return false
            end
        end
        gitCmdStatusConfig:close()
    end

    last_git_status_setting = true
    return true
end

---
-- Use a prompt coroutine to get git status in the background.
-- Cache the info so we can reuse it next time to reduce flicker.
---
local function get_git_info_table()
    local info = clink_promptcoroutine(function ()
        -- Use git status if allowed.
        local cmderGitStatusOptIn = get_git_status_setting()
        return cmderGitStatusOptIn and get_git_status() or {}
    end)
    if not info then
        info = cached_info.git_info or {}
    else
        cached_info.git_info = info
    end
    return info
end

local function git_prompt_filter()

    -- Don't do any git processing if the prompt doesn't want to show git info.
    if not clink.prompt.value:find("{git}") then
        return false
    end

    -- Colors for git status
    local colors = {
        clean = get_clean_color(),
        dirty = get_dirty_color(),
        conflict = get_conflict_color(),
        nostatus = get_unknown_color()
    }

    local git_dir = get_git_dir()
    local color
    if git_dir then
        local branch = get_git_branch(git_dir)
        if branch then
            -- If in a different repo or branch than last time, discard cached info.
            if cached_info.git_dir ~= git_dir or cached_info.git_branch ~= branch then
                cached_info.git_info = nil
                cached_info.git_dir = git_dir
                cached_info.git_branch = branch
            end

            -- If we're inside of git repo then try to detect current branch
            -- Has branch => therefore it is a git folder, now figure out status
            local gitInfo = get_git_info_table()
            local gitStatus = gitInfo.status
            local gitConflict = gitInfo.conflict

            if gitStatus == nil then
                color = colors.nostatus
            elseif gitStatus then
                color = colors.clean
            else
                color = colors.dirty
            end

            if gitConflict then
                color = colors.conflict
            end

            clink.prompt.value = gsub_plain(clink.prompt.value, "{git}", " "..color.."("..branch..")")
            return false
        end
    end

    -- No git present or not in git file
    clink.prompt.value = gsub_plain(clink.prompt.value, "{git}", "")
    return false
end

local function hg_prompt_filter()

    -- Don't do any hg processing if the prompt doesn't want to show hg info.
    if not clink.prompt.value:find("{hg}") then
        return false
    end

    local hg_dir = get_hg_dir()
    if hg_dir then
        -- Colors for mercurial status
        local colors = {
            clean = get_clean_color(),
            dirty = get_dirty_color(),
            nostatus = get_unknown_color()
        }
        local output = get_hg_branch()

        -- strip the trailing newline from the branch name
        local n = #output
        while n > 0 and output:find("^%s", n) do n = n - 1 end
        local branch = output:sub(1, n)

        if branch ~= nil and
           string.sub(branch,1,7) ~= "abort: " and             -- not an HG working copy
           (not string.find(branch, "is not recognized")) then -- 'hg' not in path
            local color = colors.clean

            local pipe = io.popen("hg status -amrd 2>&1")
            if pipe then
                output = pipe:read('*all')
                pipe:close()
                if output ~= nil and output ~= "" then color = colors.dirty end
            end

            local result = color .. "(" .. branch .. ")"
            clink.prompt.value = gsub_plain(clink.prompt.value, "{hg}", " "..result)
            return false
        end
    end

    -- No hg present or not in hg repo
    clink.prompt.value = gsub_plain(clink.prompt.value, "{hg}", "")
end

local function svn_prompt_filter()

    -- Don't do any svn processing if the prompt doesn't want to show svn info.
    if not clink.prompt.value:find("{svn}") then
        return false
    end

    -- Colors for svn status
    local colors = {
        clean = get_clean_color(),
        dirty = get_dirty_color(),
        nostatus = get_unknown_color()
    }

    local svn_dir = get_svn_dir()
    if svn_dir then
        -- if we're inside of svn repo then try to detect current branch
        local branch = get_svn_branch()
        if branch then
            -- If in a different repo or branch than last time, discard cached info
            if cached_info.svn_dir ~= svn_dir or cached_info.svn_branch ~= branch then
                cached_info.svn_info = nil
                cached_info.svn_dir = svn_dir
                cached_info.svn_branch = branch
            end
            -- Get the svn status using coroutine if available and option is enabled. Otherwise use a blocking call
            local svnStatus
            if clink.promptcoroutine and io.popenyield and settings.get("prompt.async") and prompt_overrideSvnStatusOptIn then -- luacheck: no max line length
                svnStatus = clink_promptcoroutine(function ()
                    return get_svn_status()
                end)
                -- If the status result is pending, use the cached version instead, otherwise store it to the cache
                if svnStatus == nil then
                    svnStatus = cached_info.svn_info
                else
                    cached_info.svn_info = svnStatus
                end
            else
                svnStatus = get_svn_status()
            end

            local color
            if not svnStatus or svnStatus.error then
                color = colors.nostatus
            elseif svnStatus.clean then
                color = colors.clean
            else
                color = colors.dirty
            end

            clink.prompt.value = gsub_plain(clink.prompt.value, "{svn}", " "..color.."("..branch..")")
            return false
        end
    end

    -- No svn present or not in svn file
    clink.prompt.value = gsub_plain(clink.prompt.value, "{svn}", "")
    return false
end

-- insert the set_prompt at the very beginning so that it runs first
clink.prompt.register_filter(set_prompt_filter, 1)
clink.prompt.register_filter(hg_prompt_filter, 50)
clink.prompt.register_filter(git_prompt_filter, 50)
clink.prompt.register_filter(svn_prompt_filter, 50)
clink.prompt.register_filter(percent_prompt_filter, 51)

local completions_dir = clink.get_env('CMDER_ROOT')..'/vendor/clink-completions/'
-- Execute '.init.lua' first to ensure package.path is set properly
dofile(completions_dir..'.init.lua')
for _,lua_module in ipairs(clink.find_files(completions_dir..'*.lua')) do
    -- Skip files that starts with _. This could be useful if some files should be ignored
    if not string.match(lua_module, '^_.*') then
        local filename = completions_dir..lua_module
        -- use dofile instead of require because require caches loaded modules
        -- so config reloading using Alt-Q won't reload updated modules.
        dofile(filename)
    end
end

if clink.get_env('CMDER_USER_CONFIG') then
    local cmder_config_dir = clink.get_env('CMDER_ROOT')..'/config/'
    for _,lua_module in ipairs(clink.find_files(cmder_config_dir..'*.lua')) do
        local filename = cmder_config_dir..lua_module
        -- use dofile instead of require because require caches loaded modules
        -- so config reloading using Alt-Q won't reload updated modules.
        dofile(filename)
    end
end
