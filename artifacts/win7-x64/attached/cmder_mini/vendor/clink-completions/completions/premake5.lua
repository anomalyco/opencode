--------------------------------------------------------------------------------
-- Usage:
--
-- Clink argmatcher for Premake5.  Generates completions for Premake5 by getting
-- a list of available commands and flags from Premake5.
--
-- Uses argmatcher:setdelayinit() to dynamically (re-)initialize the argmatcher
-- based on the current directory.
--
-- https://premake.github.io/

if not clink then
    -- Probably getting loaded and run inside of Premake5 itself; bail out.
    return
end

local clink_version = require('clink_version')
if not clink_version.supports_argmatcher_delayinit then
    log.info("premake5.lua argmatcher requires a newer version of Clink; please upgrade.")
    return
end

local prev_cwd = ""

local function delayinit(argmatcher)
    -- If the current directory is the same, the argmatcher is already
    -- initialized.
    local cwd = os.getcwd()
    if prev_cwd == cwd then
        return
    end

    -- Reset the argmatcher and update the current directory.
    argmatcher:reset()
    prev_cwd = cwd

    -- Invoke 'premake5 --help' and parse its output to collect the available
    -- flags and arguments.
    local actions
    local flags = {}
    local descriptions = {}
    local pending_link
    local values
    local placeholder
    local r = io.popen('premake5.exe --help 2>nul')

    -- The output from premake5 follows this layout:
    --
    --      ... ignore lines until ...
    --      OPTIONS ...
    --       --flag         Description
    --       --etc ...
    --      ACTIONS
    --       action         Description
    --       etc ...
    --      ... stop once a non-indented line is reached.
    --
    -- Additionally, some flags follow this layout:
    --
    --       --flag=value   Description of flag
    --          value        Description of value
    --          etc ...
    --      ... until another --flag line, or ACTIONS.
    --
    for line in r:lines() do
        if actions then
            -- A non-blank, non-indented line ends the actions.
            if #line > 0 and line:sub(1,1) ~= ' ' then
                break
            end
            -- Parsing an action.
            local action, description = line:match('^ ([^ ]+) +(.+)$')
            if action then
                table.insert(actions, { match=action, type="arg", description=description })
            end
        elseif line:find('^ACTIONS') then
            -- An 'ACTIONS' line starts the actions section.
            actions = {}
        elseif values and line:match('^     ') then
            -- Add a value to the values table for the pending_link.
            local value, description = line:match('^     ([^ ]+) +(.+)$')
            if value then
                table.insert(values, { match=value, type="arg", description=description })
            end
        else
            -- Not a value line, so if there's a pending_link then it's
            -- finished; add the pending values to it.
            if pending_link then
                pending_link:addarg(#values > 0 and values or placeholder)
                pending_link = nil
                values = nil
                placeholder = nil
            end
            -- Parse a flag line.
            local flag, value, description
            flag, description = line:match('^[ ]+(%-%-[^ =]+) +(.+)$')
            if not flag then
                flag, value, description = line:match('^[ ]+(%-%-[^ =]+=)([^ ]+) +(.+)$')
            end
            -- If the line defines a flag, process the flag.
            if flag then
                if description then
                    description = description:gsub('; one of:$', '')
                end
                -- Add the flag.
                if value then
                    pending_link = clink.argmatcher()
                    table.insert(flags, flag..pending_link)
                    descriptions[flag] = { value, description }
                    -- Prepare placeholder value.
                    values = {}
                    placeholder = { match=value, type="arg", description=description }
                else
                    descriptions[flag] = description
                    table.insert(flags, flag)
                end
            end
        end
    end

    r:close()

    argmatcher:addarg(actions or {})
    argmatcher:addflags(flags)
    argmatcher:adddescriptions(descriptions)
end

local matcher = clink.argmatcher('premake5')
if matcher.setdelayinit then
    matcher:setdelayinit(delayinit)
end
