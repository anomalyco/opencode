-- expect: Key 'contnet' not found
--!strict
-- A misspelled field of a server type: `read:messages` returns the HTTP API's `SessionMessageInfo`, so the checker
-- refuses `message.contnet`, which was `any` before the stub carried the API's types.
local plugin = require("@opencode/plugin")

return function(read: plugin.Read, id: string): number
    local parts = 0
    for _, message in read:messages(id) do
        if message.type == "assistant" then
            parts += #message.contnet
        end
    end
    return parts
end
