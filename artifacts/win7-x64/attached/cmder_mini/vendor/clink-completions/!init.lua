-- Note: This happens in both .init.lua and !init.lua because older Cmder
-- versions don't know about !init.lua.

-- Get the parent path of this script.
local parent_path = debug.getinfo(1, "S").source:match[[^@?(.*[\/])[^\/]-$]]

-- Extend package.path with modules directory, if not already present, to allow
-- using require() with them.
local modules_path = parent_path.."modules/?.lua"
if not package.path:find(modules_path, 1, true--[[plain]]) then
    package.path = modules_path..";"..package.path
end

-- Explicitly set the completions dir, in case something (such as Cmder)
-- manually loads completion scripts with them being in a Clink script path.
if os.setenv then
    local completions_path = parent_path.."completions"
    local env = os.getenv("CLINK_COMPLETIONS_DIR") or ""
    if not env:find(completions_path, 1, true--[[plain]]) then
        os.setenv("CLINK_COMPLETIONS_DIR", env .. (#env > 0 and ";" or "") .. completions_path)
    end
end
