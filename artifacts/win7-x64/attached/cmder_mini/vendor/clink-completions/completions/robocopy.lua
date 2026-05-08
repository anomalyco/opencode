--------------------------------------------------------------------------------
-- Clink argmatcher for Robocopy.
-- Uses delayinit to parse the Robocopy help text.

local clink_version = require('clink_version')
if not clink_version.supports_argmatcher_delayinit then
    log.info("robocopy.lua argmatcher requires a newer version of Clink; please upgrade.")
    return
end

require('arghelper')
local mcf = require('multicharflags')

local function sentence_casing(text)
    if unicode.iter then -- luacheck: no global
        for str in unicode.iter(text) do -- luacheck: ignore 512, no global
            return clink.upper(str) .. text:sub(#str + 1)
        end
        return text
    else
        return clink.upper(text:sub(1,1)) .. text:sub(2)
    end
end

local function delayinit(argmatcher)
    local r = io.popen('robocopy.exe /??? 2>nul')
    if not r then
        return
    end

    local flags = {}
    local hideflags = {}
    local descriptions = {}

    local function add_match(flag, disp, desc, linked)
        local altflag = flag:lower()
        if flag == altflag then
            altflag = nil
        end
        desc = sentence_casing(desc)
        if linked then
            table.insert(flags, flag..linked)
            if altflag then
                table.insert(flags, altflag..linked)
                table.insert(hideflags, altflag)
            end
        else
            table.insert(flags, flag)
            if altflag then
                table.insert(flags, altflag)
                table.insert(hideflags, altflag)
            end
        end
        if disp then
            descriptions[flag] = { disp, desc }
        else
            descriptions[flag] = { desc }
        end
    end

    local rashcnet_chars = {
        nosort=true,
        caseless=true,
        { 'R', 'Read-only' },
        { 'A', 'Archive' },
        { 'S', 'System' },
        { 'H', 'Hidden' },
        { 'C', 'Compressed' },
        { 'N', 'Not content indexed' },
        { 'E', 'Encrypted' },
        { 'T', 'Temporary' },
    }
    local rashcneto_chars = {
        nosort=true,
        caseless=true,
    }
    for _, x in ipairs(rashcnet_chars) do
        table.insert(rashcneto_chars, x)
    end
    table.insert(rashcneto_chars, { 'O', 'Offline' })

    local copy_flag_chars = {
        nosort=true,
        caseless=true,
        { 'D', 'Data' },
        { 'A', 'Attributes' },
        { 'T', 'Timestamps' },
        { 'S', 'NTFS ACLs' },
        { 'O', 'Owner info' },
        { 'U', 'aUditing info' },
        { 'X', 'Skip alt data streams' },
    }
    local dcopy_flag_chars = {
        nosort=true,
        caseless=true,
        { 'D', 'Data' },
        { 'A', 'Attributes' },
        { 'T', 'Timestamps' },
        { 'E', 'EAs' },
        { 'X', 'Skip alt data streams' },
    }

    local rashcnet = mcf.addcharflagsarg(clink.argmatcher(), rashcnet_chars)
    local rashcneto = mcf.addcharflagsarg(clink.argmatcher(), rashcneto_chars)
    local copy_flags = mcf.addcharflagsarg(clink.argmatcher(), copy_flag_chars)
    local dcopy_flags = mcf.addcharflagsarg(clink.argmatcher(), dcopy_flag_chars)

    for line in r:lines() do
        if unicode.fromcodepage then -- luacheck: no global
            line = unicode.fromcodepage(line) -- luacheck: no global
        end
        local f,d = line:match('^ *(/[^ ]+) :: (.+)$')
        if f then
            local a,b = f:match('^(.-)%[:(.+)%]$')
            if a then
                add_match(a, nil, d)
                add_match(a..':', b, d)
            else
                a,b = f:match('^([^:]+:)(.+)$')
                if not a then
                    a,b = f:match('^([^ ]+)( .+)$')
                end
                if a then
                    if a == "/A-:" or a == "/A+:" then
                        -- TODO: Clink can't do completions for /A+: yet.
                        add_match(a, b, d, rashcnet)
                    elseif a == "/IA:" or a == "/XA:" then
                        add_match(a, b, d, rashcneto)
                    elseif a == "/COPY:" then
                        add_match(a, b, d, copy_flags)
                    elseif a == "/DCOPY:" then
                        add_match(a, b, d, dcopy_flags)
                    else
                        add_match(a, b, d)
                    end
                else
                    add_match(f, nil, d)
                end
            end
        end
    end

    r:close()

    argmatcher:addflags(flags)
    argmatcher:hideflags(hideflags)
    argmatcher:adddescriptions(descriptions)
    return true
end

clink.argmatcher('robocopy'):setdelayinit(delayinit)
