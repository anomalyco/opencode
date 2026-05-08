-- By default, this omits targets with / or \ in them.  To include such targets,
-- set %INCLUDE_PATHLIKE_MAKEFILE_TARGETS% to any non-empty string.

local clink_version = require('clink_version')

require('arghelper')

-- Table of special targets to always ignore.
local special_targets = {
    ['.PHONY'] = true,
    ['.SUFFIXES'] = true,
    ['.DEFAULT'] = true,
    ['.PRECIOUS'] = true,
    ['.INTERMEDIATE'] = true,
    ['.SECONDARY'] = true,
    ['.SECONDEXPANSION'] = true,
    ['.DELETE_ON_ERROR'] = true,
    ['.IGNORE'] = true,
    ['.LOW_RESOLUTION_TIME'] = true,
    ['.SILENT'] = true,
    ['.EXPORT_ALL_VARIABLES'] = true,
    ['.NOTPARALLEL'] = true,
    ['.ONESHELL'] = true,
    ['.POSIX'] = true,
    ['.NOEXPORT'] = true,
    ['.MAKE'] = true,
}

-- Function to parse a line of nmake output, and add any extracted target to the
-- specified targets table.
local function extract_target(line, last_line, targets, include_pathlike)
    -- Strip comments.
    line = line:gsub('(#.*)$', '')

    -- Ignore when not a target (is this only for GNU make?).
    if last_line:find('# Not a target') then
        return
    end

    -- Extract possible target.
    local p = (
        line:match('^([^%s]+):$') or    -- When target has no deps.
        line:match('^([^%s]+): '))      -- When target has deps.
    if not p then
        return
    end

    -- Ignore special targets.
    if special_targets[p] then
        return
    end

    -- Maybe ignore path-like targets.
    local mt
    if include_pathlike then
        if not p:find('[/\\]') then
            mt = 'alias'
        end
    else
        if p:find('[/\\]') then
            return
        end
    end

    -- Add target.
    table.insert(targets, {match=p, type=mt})
end

-- Function to compile argmatcher flags table from a definition table.  Each
-- flag is expanded to both -x and /x variants.  Optionally, both lower and
-- upper case variants can be added (in which case the upper case variants are
-- hidden when listing available completions).
local function compile_flags_table(flags_def, both_cases)
    local maxcasemode = (both_cases and 1 or 0)
    maxcasemode = (clink_version.supports_argmatcher_hideflags and maxcasemode or 0)

    local flags_table = {}
    for _, e in ipairs(flags_def) do
        local slash, slashentry
        local dash, dashentry
        for casemode = 0, maxcasemode, 1 do
            local istable = type(e[1]) == 'table'
            local flag = istable and e[1][1] or e[1]
            local has_args
            -- When adding both cases, pass 0 is lower and pass 1 is upper.
            if maxcasemode > 0 then
                if casemode == 0 then
                    flag = flag:lower()
                elseif casemode == 1 then
                    flag = flag:upper()
                end
            end
            -- Add flag character (/ or -) and optional parser.
            if istable then
                slash = ('/'..flag)..e[1][2]
                dash = ('-'..flag)..e[1][2]
                has_args = true
            else
                slash = '/'..flag
                dash = '-'..flag
            end
            -- Build flag entries to be added to the argmatcher.
            if has_args then
                slashentry = { slash, e[1][3], e[2] }
                dashentry = { dash, e[1][3], e[2] }
            else
                slashentry = { slash, e[2] }
                dashentry = { dash, e[2] }
            end
            -- When adding both cases, hide upper case flag variants.
            if maxcasemode > 0 and casemode > 0 then
                slashentry.hide = true
                dashentry.hide = true
            end
            -- Add the flag entries.
            table.insert(flags_table, slashentry)
            table.insert(flags_table, dashentry)
        end
    end

    return flags_table
end

-- Sort comparator to sort pathlike targets last.
local function comp_target_sort(a, b)
    local a_alias = (a.type == 'alias')
    local b_alias = (b.type == 'alias')
    if a_alias ~= b_alias then
        return a_alias
    else
        return string.comparematches(a.match, b.match)
    end
end

-- Function to collect available targets.
local function get_targets(word, word_index, line_state, builder, user_data) -- luacheck: no unused
    local command = '"'..line_state:getword(line_state:getcommandwordindex())..'" /p /q /r'
    if user_data and user_data.makefile then
        command = command..' /f "'..user_data.makefile..'"'
    end

    local file = io.popen('2>nul '..command)
    if not file then
        return
    end

    local targets = {}
    local last_line = ''

    -- Extract targets to be included.
    local include_pathlike = os.getenv('INCLUDE_PATHLIKE_MAKEFILE_TARGETS') and true
    for line in file:lines() do
        extract_target(line, last_line, targets, include_pathlike)
        last_line = line
    end

    file:close()

    -- When including pathlike targets, sort them last.
    if include_pathlike and string.comparematches then
        table.sort(targets, comp_target_sort)
        if builder.setnosort then
            builder:setnosort()
        end
    end

    return targets
end

-- Function to detect flags for overriding the default makefile.
local function onarg_flags(arg_index, word, word_index, line_state, user_data) -- luacheck: no unused
    if word:match('^[-/][fF]') then
        word = word:sub(3)
        -- Remember the specified makefile so get_targets() can use it.
        if word == '' then
            user_data.makefile = line_state:getword(word_index + 1)
        else
            user_data.makefile = word
        end
    end
end

-- Completions for certain flags.
local er_parser = clink.argmatcher():addarg({'none', 'prompt', 'queue' ,'send'})
local file_matches = clink.argmatcher():addarg(clink.filematches)

-- Definitions for flags.  This is used to build a table of / and - variants for
-- each flag, since nmake supports both.
local flags_def = {
    { 'a',                                  'Build all evaluated targets' },
    { 'b',                                  'Build if time stamps are equal' },
    { 'c',                                  'Suppress output messages' },
    { 'd',                                  'Display build information' },
    { 'e',                                  'Override env-var macros' },
    { {'errorreport:', er_parser, 'mode'},  'Report errors to Microsoft' },
    { {'f', file_matches, ' makefile'},     'Use the specified makefile' },
    { 'g',                                  'Display !include filenames' },
    { 'help',                               'Display brief usage message' },
    { 'i',                                  'Ignore exit codes from commands' },
    { 'k',                                  'Build unrelated targets on error' },
    { 'n',                                  'Display commands but do not execute' },
    { 'nologo',                             'Suppress copyright message' },
    { 'p',                                  'Display NMAKE information' },
    { 'q',                                  'Check time stamps but do not build' },
    { 'r',                                  'Ignore predefined rules/macros' },
    { 's',                                  'Suppress executed-commands display' },
    { 't',                                  'Change time stamps but do not build' },
    { 'u',                                  'Dump inline files' },
    { {'x', file_matches, ' stderrfile'},   'Write errors to the specified file' },
    { 'y',                                  'Disable batch-mode' },
    { '?',                                  'Display brief usage message' },
}

-- Use the flags_def table to generate all the variants for each flag, since
-- nmake supports both - and / flags, as well as both lower and upper case.
local flags_table = compile_flags_table(flags_def)

-- Add onarg function to detect when the user overrides the default makefile.
flags_table.onarg = onarg_flags

-- Create an argmatcher for nmake.
clink.argmatcher("nmake")
:_addexflags(flags_table)
:addarg({get_targets})
:loop()
