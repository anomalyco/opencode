
local gitutil = require('gitutil')

-- TODO: cache config based on some modification indicator (system mtime, hash)

-- luacheck: globals clink.promptcoroutine io.popenyield

---
-- Forward/backward compatibility for Clink asynchronous prompt filtering.
-- With Clink v1.2.10 and higher this lets git status run in the background and
-- refresh the prompt when it finishes, to eliminate waits in large git repos.
---
local io_popenyield -- luacheck: no unused
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

local function load_git_config(git_dir)
    if not git_dir then return nil end
    local file = io.open(git_dir.."/config", 'r')
    if not file then return nil end

    local config = {};
    local section;
    for line in file:lines() do
        if (line:sub(1,1) == "[" and line:sub(-1) == "]") then
            if (line:sub(2,5) == "lfs ") then
                section = nil -- skip LFS entries as there can be many and we never use them
            else
                section = line:sub(2,-2)
                config[section] = config[section] or {}
            end
        elseif section then
            local param, value = line:match('^%s-([%w|_]+)%s-=%s+(.+)$')
            if (param and value ~= nil) then
                config[section][param] = value
            end
        end
    end
    file:close();
    return config;
end

---
 -- Escapes every non-alphanumeric character in string with % symbol. This is required
 -- because string.gsub treats plain strings with some symbols (e.g. dashes) as regular
 -- expressions. See "Patterns" (https://www.lua.org/manual/5.2/manual.html#6.4.1).
 -- @param {string} text Text to escape
 -- @returns {string} Escaped text
---
local function escape_find_arg(text)
    return text and text:gsub("([-+*?.%%()%[%]$^])", "%%%1") or ""
end
local function escape_replace_arg(text)
    return text and text:gsub("%%", "%%%%") or ""
end

local function get_git_config_value(git_config, section, param)
    if (not param) or (not section) then return nil end
    if not git_config then return nil end

    return git_config[section] and git_config[section][param] or nil
end

---
-- Use a prompt coroutine to do remote and ref resolution in the background.
--
-- Even though this doesn't spawn `git config` (which can be slow in some
-- repos), it does load the config file and in some repos that might be large.
-- So, use a prompt coroutine to enable caching the results so that it's only
-- loaded once per prompt refresh.  I.e. when other async prompt filters
-- finish and refresh the prompt, this uses the cached value instead of
-- recomputing it each time.  This is probably just a very tiny optimization,
-- but there might be some repos where it makes a noticeable difference.
---
local function get_git_remote(git_dir, branch)
    local info = clink_promptcoroutine(function ()
        -- for remote and ref resolution algorithm see https://git-scm.com/docs/git-push
        local git_config = load_git_config(git_dir)
        local remote_to_push = get_git_config_value(git_config, 'branch "'..branch..'"', 'remote') or ''
        local remote_ref = get_git_config_value(git_config, 'remote "'..remote_to_push..'"', 'push') or
            get_git_config_value(git_config, 'push', 'default')

        local text = remote_to_push
        if remote_ref then text = text..'/'..remote_ref end

        if text == '' then return {} end
        return { branch=branch, remote=text }
    end)
    if not info then
        info = cached_info.info or {}
    else
        cached_info.info = info
    end
    return info
end

local function git_prompt_filter()
    -- Check for Cmder configured Git Status Opt In/Out - See: https://github.com/cmderdev/cmder/issues/2484
    if cmderGitStatusOptIn == false then return false end  -- luacheck: globals cmderGitStatusOptIn

    -- PROBLEM: This was intended for use with Cmder, but it also runs against
    -- non-Cmder prompts, which can potentially cause problems.  So, the
    -- following provides a way to disable this prompt replacement behavior
    -- without needing to delete this file.
    -- Use a Lua script to set the global variable
    --      DISABLE_GIT_REMOTE_IN_PROMPT = true
    -- and that will turn off the replacement feature.
    if DISABLE_GIT_REMOTE_IN_PROMPT then return false end  -- luacheck: globals DISABLE_GIT_REMOTE_IN_PROMPT

    local git_dir = gitutil.get_git_dir()
    if not git_dir then return false end

    -- if we're inside of git repo then try to detect current branch
    local branch = gitutil.get_git_branch(git_dir)
    if not branch then return false end

    -- Replace "(branch" with "(branch -> remote".
    local info = get_git_remote(git_dir, branch)
    if info.branch and info.remote then
        local find = escape_find_arg('('..info.branch)
        local replace = '%1 -> '..escape_replace_arg(info.remote)
        clink.prompt.value = clink.prompt.value:gsub(find, replace)
    end

    return false
end

-- Register filter with priority 60 which is greater than
-- Cmder's git prompt filters to override them
clink.prompt.register_filter(git_prompt_filter, 60)
