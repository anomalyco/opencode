-- Completions for delta (https://github.com/dandavison/delta).

--------------------------------------------------------------------------------
local function list_languages(_, _, _, builder)
    local m = {}
    local f = io.popen('2>nul delta.exe --list-languages')
    if f then
        if builder.setforcequoting then
            builder:setforcequoting()
            for line in f:lines() do
                local lang = line:match('^([^\x1b]+) \x1b')
                if lang then
                    lang = lang:gsub(' +$', '')
                    table.insert(m, lang)
                end
            end
        else
            for line in f:lines() do
                local lang = line:match('^([^\x1b]+) \x1b')
                if lang then
                    lang = lang:gsub(' +$', '')
                    if lang:find('[+ ()]') then
                        lang = '"' .. lang .. '"'
                    end
                    table.insert(m, lang)
                end
            end
        end
        f:close()
    end
    return m
end

--------------------------------------------------------------------------------
local function list_themes(_, _, _, builder)
    local m = {}
    local f = io.popen('2>nul delta.exe --list-syntax-themes')
    if f then
        if builder.setforcequoting then
            builder:setforcequoting()
            for line in f:lines() do
                line = line:gsub('^dark%s+', ''):gsub('^light%s+', '')
                table.insert(m, line)
            end
        else
            for line in f:lines() do
                line = line:gsub('^dark%s+', ''):gsub('^light%s+', '')
                if line:find('[+ ()]') then
                    line = '"' .. line .. '"'
                end
                table.insert(m, line)
            end
        end
        f:close()
    end
    return m
end

--------------------------------------------------------------------------------
local function add_pending(pending, flags, descriptions, hideflags) -- luacheck: no unused
    if pending then
        if pending.arginfo and pending.desc and not pending.values then
            if pending.arginfo:find('[a-z]') then
                pending.values = pending.values or {}
                for _, v in ipairs(string.explode(pending.arginfo, '<|>')) do
                    table.insert(pending.values, v)
                end
            elseif pending.long == '--default-language' then
                pending.values = { list_languages }
            elseif pending.long == '--syntax-theme' then
                pending.values = { list_themes }
            elseif pending.arginfo == '<PATH>'  then
                pending.values = { clink.filematches }
            elseif pending.arginfo == '<CMD>' then
                pending.values = { history=true, clink.filematches }
            end
            if not pending.values then
                pending.values = { history=true }
            end
        end

        if pending.desc then
            pending.desc = pending.desc:gsub('%([^)]+%)', '')
            pending.desc = pending.desc:gsub('For example.*$', '')
            pending.desc = pending.desc:gsub('%..*$', '')
            pending.desc = pending.desc:gsub(' +$', '')
        end

        if pending.values then
            local parser = clink.argmatcher():addarg(pending.values)
            if pending.short then
                table.insert(flags, pending.short .. parser)
            end
            if pending.long then
                table.insert(flags, pending.long .. parser)
            end
        else
            if pending.short then
                table.insert(flags, pending.short)
            end
            if pending.long then
                table.insert(flags, pending.long)
            end
        end

        if pending.desc then
            if pending.short then
                descriptions[pending.short] = { pending.desc }
                if pending.arginfo then
                    table.insert(descriptions[pending.short], 1, pending.arginfo)
                end
            end
            if pending.long then
                descriptions[pending.long] = { pending.desc }
                if pending.arginfo then
                    table.insert(descriptions[pending.long], 1, pending.arginfo)
                end
            end
        end
    end
end

--------------------------------------------------------------------------------
local inited

--------------------------------------------------------------------------------
local function delayinit(argmatcher)
    if inited then
        return
    end
    inited = true

    local f = io.popen('2>nul delta.exe --help')
    if not f then
        return
    end

    local flags = {}
    local descriptions = {}
    local hideflags = {}
    local pending

    local section = 'text'
    for line in f:lines() do
        -- delta has no way to suppress escape codes in --help output?
        line = console.plaintext(line) -- luacheck: no global

        local short, long = line:match('^  (%-.), (%-%-%g+)')
        if not short then
            long = line:match('^      (%-%-%g+)')
        end
        if long then
            add_pending(pending, flags, descriptions, hideflags)
            section = 'desc'
            pending = {}
            pending.short = short
            pending.long = long
            pending.arginfo = line:match('%-%-%g+ (.*)$')
            if pending.arginfo then
                pending.arginfo = ' ' .. pending.arginfo
            end
        elseif section == 'desc' then
            line = line:gsub('^( +)', ''):gsub('( +)$', '')
            if line == '' then
                section = pending.arginfo and 'values' or 'text'
            else
                if pending.desc then
                    pending.desc = pending.desc .. ' '
                else
                    pending.desc = ''
                end
                pending.desc = pending.desc .. line
            end
        elseif section == 'values' then
            local value = line:match('^ +%* ([-A-Za-z0-9_]+)')
            if value then
                if not pending.values then
                    pending.values = {}
                end
                table.insert(pending.values, value)
            end
        end
    end
    add_pending(pending, flags, descriptions, hideflags)

    f:close()

    argmatcher:addflags(flags)
    argmatcher:addflags(hideflags)

    if argmatcher.adddescriptions then
        argmatcher:adddescriptions(descriptions)
    end
    if argmatcher.hideflags then
        argmatcher:hideflags(hideflags)
    end
end

--------------------------------------------------------------------------------
clink.argmatcher('delta'):setdelayinit(delayinit)

