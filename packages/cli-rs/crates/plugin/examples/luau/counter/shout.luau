--!strict
-- The `shout` fence: each line of the block in capitals, bold. A module of its own, which `init.luau` requires.
local plugin = require("@opencode/plugin")

return function(_read: plugin.Read, fence: plugin.Fence): plugin.Fenced
    local lines = {}
    for line in string.gmatch(fence.code, "[^\n]+") do
        table.insert(lines, { { text = string.upper(line), bold = true } })
    end
    return { type = "lines", lines = lines }
end
