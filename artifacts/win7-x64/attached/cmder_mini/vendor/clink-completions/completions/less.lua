--------------------------------------------------------------------------------
-- Clink argmatcher for LESS
--
-- Info:    http://www.greenwoodsoftware.com/less
-- Repo:    https://github.com/gwsw/less.git

local clink_version = require('clink_version')
if not clink_version.supports_argmatcher_delayinit then
    log.info("less.lua argmatcher requires a newer version of Clink; please upgrade.")
    return
end

local inited

local function init(argmatcher)
    if inited then
        return
    end
    inited = true

    local file = io.popen('less --help')
    if not file then
        return
    end

    local section = 'header'
    local flags = {}
    local descriptions = {}
    local pending

    for line in file:lines() do
        line = line:gsub('.\x08', '')
        if section == 'header' then
            if line:match('^ +OPTIONS') then
                section = 'options'
            end
        elseif section == 'options' then
            if line:find('^ *%-%-%-%-%-%-%-%-%-%-') then
                section = 'done'
            elseif pending then
                local desc = line:match('^[ \t]+([^ \t].*)$')
                if desc then
                    local args
                    desc = desc:gsub('%.+$', '')
                    for _,f in ipairs(pending) do
                        local display = f:match('%=(.+)$') or f:match('( .+)$')
                        if display then
                            if not args then
                                if display:find('file') then
                                    args = clink.argmatcher():addarg(clink.filematches)
                                else
                                    args = clink.argmatcher():addarg({fromhistory=true})
                                end
                            end
                            f = f:sub(1, #f - #display)
                            if args then
                                table.insert(flags, f .. args)
                            else
                                table.insert(flags, f)
                            end
                            descriptions[f] = { display, desc }
                        else
                            table.insert(flags, f)
                            descriptions[f] = { desc }
                        end
                    end
                end
                pending = nil
            elseif line:match('^ +%-') then
                line = line:gsub('^ +', '')
                while true do
                    local f = line:match('^(%-.-)  ') or line:match('^(%-%-[^ ]+)$')
                    if not f then
                        break
                    end
                    line = line:sub(#f + 1):gsub('^[ .]+', '')

                    pending = pending or {}
                    f = f:gsub(' +$', '')
                    table.insert(pending, f)
                end
            end
        else -- luacheck: ignore 542
            -- Nothing to do.
        end
    end

    file:close()

    argmatcher:addflags(flags)
    argmatcher:adddescriptions(descriptions)
end

local a = clink.argmatcher('less')
if a.setdelayinit then
    a:setdelayinit(init)
else
    init(a)
end
