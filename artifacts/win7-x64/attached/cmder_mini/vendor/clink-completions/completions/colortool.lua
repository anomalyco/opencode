local clink_version = require('clink_version')
if not clink_version.supports_argmatcher_delayinit then
    log.info("colortool.lua argmatcher requires a newer version of Clink; please upgrade.")
    return
end

local function init_themes(argmatcher, argindex) -- luacheck: no unused
    local matches = {}
    local r = io.popen('colortool -s')
    if not r then
        return
    end

    for line in r:lines() do
        local name = line:match('^(.-)\x1b')
        if name then
            local color = line:match('^[^\x1b]*(\x1b.*)$')
            name = name:gsub(' +$', '')
            color = color and '\x1b[m'..color..'\x1b[m' or ''
            table.insert(matches, {match=name, description=color})
        end
    end

    r:close()
    return matches
end

local function forcequoting(_, _, _, builder)
    if builder.setforcequoting then
        builder:setforcequoting()
    end
    return {}
end

local function closure(argmatcher)
    argmatcher:addarg({delayinit=init_themes, forcequoting})
    argmatcher:nofiles()
end

local help_parser = require('help_parser')
help_parser.make('colortool', '-?', 'curl', nil, closure)
