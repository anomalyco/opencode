--!strict
-- The `shout` fence: each line of the block in capitals, bold. A module of its own, which `init.luau` requires.

return function(_read, fence)
    local lines = {}
    for line in string.gmatch(fence.code, "[^\n]+") do
        table.insert(lines, { { text = string.upper(line), bold = true } })
    end
    return { type = "lines", lines = lines }
end
