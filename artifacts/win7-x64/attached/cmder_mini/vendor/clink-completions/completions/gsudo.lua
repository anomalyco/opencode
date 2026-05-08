local clink_version = require('clink_version')
if not clink_version.supports_argmatcher_chaincommand then
    log.info("gsudo.lua argmatcher requires a newer version of Clink; please upgrade.")
    return
end

require('arghelper')

-- luacheck: no max line length
-- luacheck: globals string.equalsi

local integrity = clink.argmatcher():addarg({'Untrusted', 'Low', 'Medium', 'MediumPlus', 'High', 'System' })
local username = clink.argmatcher():addarg({fromhistory=true})
local loglevel = clink.argmatcher():addarg({'All', 'Debug', 'Info', 'Warning', 'Error', 'None'})

clink.argmatcher('gsudo')
:chaincommand()
:_addexflags({
    { hide=true, '-?' },
    { hide=true, '-h' },
    {            '--help',                                  'Show help text' },
    { hide=true, '-v' },
    {            '--version',                               'Show version info' },
    -- New Window options:
    { hide=true, '-n' },
    {            '--new',                                   'Starts the command in a new console (and returns immediately)' },
    { hide=true, '-w' },
    {            '--wait',                                  'When in new console, wait for the command to end and return the exitcode' },
    {            '--keepShell',                             'Keep elevated shell open after running {command}' },
    {            '--keepWindow',                            'When in new console, ask for keypress before closing the console' },
    {            '--close',                                 'Override settings and always close new window at end' },
    -- Security options:
    { hide=true, '-i'..integrity },
    {            '--integrity'..integrity,  ' {v}',         'Run with specified integrity level' },
    { hide=true, '-u'..username },
    {            '--user'..username,        ' {username}',  'Run as the specified user. Asks for password. For local admins shows UAC unless \'-i Medium\'' },
    { hide=true, '-s' },
    {            '--system',                                'Run as Local System account (NT AUTHORITY\\SYSTEM)' },
    {            '--ti',                                    'Run as member of NT SERVICE\\TrustedInstaller group' },
    { hide=true, '-k' },
    {            '--reset-timestamp',                       'Kills all cached credentials. The next time gsudo is run a UAC popup will be appear' },
    -- Shell related options:
    { hide=true, '-d' },
    {            '--direct',                                'Skip Shell detection. Assume CMD shell or CMD {command}' },
    -- Other options:
    {            '--loglevel'..loglevel,    ' {val}',       'Set minimum log level to display' },
    {            '--debug',                                 'Enable debug mode' },
    {            '--copyns',                                'Connect network drives to the elevated user. Warning: Interactively asks for credentials' },
    -- Configuration:
    --           gsudo config {key} [--global]              Affects all users (overrides user settings)
    -- From PowerShell:
    --{ ScriptBlock }     Must be wrapped in { curly brackets }
    {            '--loadProfile',                           'When elevating PowerShell commands, load user profile' },
    -- Deprecated:
    { hide=true, '--copyev',                                '(deprecated) Copy all environment variables to the elevated process' },
    { hide=true, '--attached' },
    { hide=true, '--piped' },
    { hide=true, '--vt' },
})

local gen = clink.generator(1)

local function parse_words(line_state)
    local cwi = line_state:getcommandwordindex()
    if not cwi or cwi < 1 then
        return
    end

    local cw = line_state:getword(cwi)
    if not (string.equalsi(cw, 'sudo') or
            string.equalsi(cw, 'gsudo')) then
        return
    end

    local nw = line_state:getword(cwi + 1)
    if not (nw == 'config' or
            nw == 'cache' or
            nw == 'status') then
        return
    end

    return nw, cwi + 1
end

function gen:generate(line_state, match_builder) -- luacheck: no unused
    local nw, nwi = parse_words(line_state)
    if not nw then
        return
    end

    local ls = line_state
    if nw == 'config' then
        local wc = ls:getwordcount()
        if wc == nwi + 1 then
            local f = io.popen('2>nul gsudo.exe config')
            if not f then
                return true
            end
            for line in f:lines() do
                local opt = line:match('^([^ ]+) = ')
                if opt then
                    match_builder:addmatch(opt, 'word')
                end
            end
            f:close()
        elseif wc == nwi + 2 then
            local info = ls:getwordinfo(wc)
            local tocursor = ls:getline():sub(info.offset, ls:getcursor() - 1)
            if tocursor == '-' or tocursor:match('^%-%-') then
                match_builder:addmatch({
                    match = '--global',
                    description = 'Affects all users (overrides user settings)',
                    type = 'word',
                })
            end
        end
        return true
    elseif nw == 'cache' then
        match_builder:addmatches({'on', 'off', 'help'}, 'arg')
        return true
    elseif nw == 'status' then
        return true
    end
end

local clf = clink.classifier(1)

function clf:classify(commands) -- luacheck: no unused
    local none = settings.get('color.unexpected')
    for _, c in ipairs(commands) do
        local ls = c.line_state
        local nw, nwi = parse_words(ls)
        if nw then
            local info, endinfo, ccw
            if nw == 'status' then
                info = ls:getwordinfo(nwi + 1)
            elseif nw == 'cache' then
                ccw = ls:getword(nwi + 1)
                if not (ccw == 'on' or ccw == 'off' or ccw == 'help') then
                    ccw = nil
                end
                info = ls:getwordinfo(nwi + (ccw and 2 or 1))
            end
            if info then
                endinfo = ls:getwordinfo(ls:getwordcount())
                c.classifications:applycolor(info.offset, endinfo.offset + endinfo.length - info.offset, none)
            end
            c.classifications:classifyword(nwi, 'a', true)
            if nw == 'cache' and ccw then
                c.classifications:classifyword(nwi + 1, 'a', true)
            elseif nw == 'config' and ls:getword(nwi + 2) == '--global' then
                c.classifications:classifyword(nwi + 2, 'f', true)
            end
        end
    end
end
