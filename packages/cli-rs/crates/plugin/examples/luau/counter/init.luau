--!strict
-- A counter in the sidebar that `/count` and a click raise and storage keeps,
-- `/count-reset` asks before it clears it, a toast on a finished session, and a `shout` fence.
local plugin = require("@opencode/plugin")
local shout = require("@self/shout")

local COUNT = "count"

local function stored(read: plugin.Read): number
    local value = read:storageGet(COUNT)
    return if value and value.value then value.value else 0
end

return plugin.define(function(setup)
    setup:storageKey(COUNT)
    setup:command({ name = "counter.count", title = "Count", slash = "count", palette = true }, function(host)
        host:storageSet(COUNT, { value = stored(host) + 1 })
    end)
    setup:command({ name = "counter.reset", title = "Reset the count", slash = "count-reset", palette = true }, function(host)
        host:dialog({
            type = "confirm",
            title = "Reset the count?",
            message = `The count is {stored(host)}.`,
            action = plugin.command("counter.reset.answer"),
        })
    end)
    -- The confirm's answer: `true` for Confirm, `false` for Cancel and escape.
    setup:command({ name = "counter.reset.answer" }, function(host, answer)
        if answer == "true" then
            host:storageSet(COUNT, { value = 0 })
            host:toast({ variant = "info", title = "Counter", message = "The count is 0" })
        end
    end)
    setup:slot({ path = "sidebar.content" }, function(read, _, changed)
        if not (changed.all or changed["local"]) then
            return plugin.KEEP
        end
        local count = plugin.text({ plugin.span(`Counted {stored(read)}`, { fg = "text.muted" }) })
        return plugin.show(plugin.column({ count }, { on_click = plugin.click("counter.count") }))
    end)
    setup:onEvent({ "session.execution.succeeded" }, function(host)
        host:toast({ variant = "info", title = "Counter", message = "A session finished" })
    end)
    setup:codeBlock("shout", shout)
end)
