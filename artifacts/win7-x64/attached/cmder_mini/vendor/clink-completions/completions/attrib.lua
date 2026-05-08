--------------------------------------------------------------------------------
-- Usage:
--
-- Argmatcher for ATTRIB.  Uses delayinit to support localized help text.

--------------------------------------------------------------------------------
local clink_version = require('clink_version')
if not clink_version.supports_argmatcher_delayinit then
    log.info("attrib.lua argmatcher requires a newer version of Clink; please upgrade.")
    return
end

--------------------------------------------------------------------------------
local function add_pending(pending, flags, descriptions, hideflags)
    if pending then
        table.insert(flags, pending.flag)
        table.insert(hideflags, pending.flag:lower())
        local desc = pending.desc:gsub('[ .]+$', '')
        descriptions[pending.flag] = { desc }
    end
end

--------------------------------------------------------------------------------
local function make_desc(lhs, rhs)
    if rhs:match('^[A-Z][a-z ]') then
        rhs = rhs:sub(1, 1):lower() .. rhs:sub(2)
    end
    return lhs .. rhs:gsub('[ .]+$', '')
end

--------------------------------------------------------------------------------
local inited

--------------------------------------------------------------------------------
local function delayinit(argmatcher)
    if inited then
        return
    end
    inited = true

    local f = io.popen('attrib /?')
    if not f then
        return
    end

    local flags = {}
    local descriptions = {}
    local hideflags = {}
    local pending

    local section = 'header'
    for line in f:lines() do
        if unicode.fromcodepage then -- luacheck: no global
            line = unicode.fromcodepage(line) -- luacheck: no global
        end
        if section == 'attrs' then
            local attr, desc = line:match('^ +([A-Z])  +([^ ].+)$')
            if attr then
                table.insert(flags, '+'..attr)
                table.insert(flags, '-'..attr)
                table.insert(hideflags, '+'..attr:lower())
                table.insert(hideflags, '-'..attr:lower())
                descriptions['+'..attr] = { make_desc('Set ', desc) }
                descriptions['-'..attr] = { make_desc('Clear ', desc) }
            elseif line:match('^ +%[') then
                section = 'flags'
            end
        elseif section == 'flags' then
            local indent, flag, pad, desc = line:match('^( +)(/[^ ]+)( +)([^ ].*)$')
            if flag then
                add_pending(pending, flags, descriptions, hideflags)
                pending = {}
                pending.indent = #indent + #flag + #pad
                pending.flag = flag
                pending.desc = desc:gsub(' +$', '')
            elseif pending then
                indent, desc = line:match('^( +)([^ ].*)$')
                if indent and #indent == (pending.indent or 0) then
                    pending.desc = pending.desc .. ' ' .. desc:gsub(' +$', '')
                else
                    add_pending(pending, flags, descriptions, hideflags)
                    pending = nil
                end
            else
                add_pending(pending, flags, descriptions, hideflags)
                pending = nil
            end
        elseif section == 'header' then
            if line:match('^ +%+  +') then
                section = 'attrs'
            end
        end
    end
    add_pending(pending, flags, descriptions, hideflags)

    f:close()

    argmatcher:addflags(flags)
    argmatcher:addflags(hideflags)
    argmatcher:adddescriptions(descriptions)
    argmatcher:hideflags(hideflags)
end

--------------------------------------------------------------------------------
clink.argmatcher('attrib'):setdelayinit(delayinit)
