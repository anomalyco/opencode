-- expect: sesionID
--!strict
-- A misspelled field in a typed call: `plugin.client` types each operation's input with the generated client's
-- fields, so the checker refuses `sesionID` in `session.inbox.list`'s input.
local plugin = require("@opencode/plugin")

return function(id: string): number
    local items = plugin.client.session.inbox.list({ sesionID = id })
    return if items then #items else 0
end
