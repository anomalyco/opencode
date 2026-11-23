--!strict
-- The plugin of the life machine (parity/machines/plugins.json), opencode-native side: `tui.tsx` in Luau, checked
-- against the file, not against `tui.tsx`. A line in home.footer shows A or B, its build, then the pending keys while a
-- sequence is pending. Life flip flips the line, Life throw throws, Life stall spins for 150 ms of CPU time (past the
-- Luau budget), Life arm makes the next setup throw, Life dialog opens a prompt, Life confirm asks whether to flip the
-- line, and Life alert flips it once it closes. With the option fail its setup throws, for the views machine.
-- crates/tui/tests/all/plugin_machines.rs copies this directory and rewrites `BUILD` to reload it.
local plugin = require("@opencode/plugin")

local BUILD = 1

return plugin.define(function(setup)
    -- The views machine: the setup fails as the plugin first loads, so its row is failed with an error.
    if setup.options and setup.options.fail then
        error("life setup fails as it loads")
    end
    -- Storage outlives an activation, so an armed setup throws on the next enable, once.
    setup:storageKey("armed")
    local armed = setup.host:storageGet("armed")
    if armed and armed.on then
        setup.host:storageSet("armed", { on = false })
        error("life setup armed to throw")
    end
    local side = "A"
    local function flip()
        side = if side == "A" then "B" else "A"
    end
    local function command(name: string, title: string): plugin.CommandSpec
        return { name = name, title = title, palette = true }
    end
    setup:command(command("life.flip", "Life flip"), function()
        flip()
    end)
    setup:command(command("life.throw", "Life throw"), function()
        error("life command throws")
    end)
    setup:command(command("life.stall", "Life stall"), function()
        local start = os.clock()
        while os.clock() - start < 0.15 do
        end
    end)
    setup:command(command("life.arm", "Life arm"), function(host)
        host:storageSet("armed", { on = true })
    end)
    setup:command(command("life.dialog", "Life dialog"), function(host)
        host:prompt({ title = "Life prompt" })
    end)
    setup:command(command("life.confirm", "Life confirm"), function(host)
        if host:confirm({ title = "Life asks", message = "Flip the line?" }) then
            flip()
        end
    end)
    setup:command(command("life.alert", "Life alert"), function(host)
        host:alert({ title = "Life says", message = "The line flips as this closes." })
        flip()
    end)
    setup:slot({ path = "home.footer" }, function(read)
        local pending = {}
        for _, part in read:keymapPending() do
            table.insert(pending, part.key)
        end
        local keys = if #pending > 0 then " keys " .. table.concat(pending, " ") else ""
        return plugin.show(plugin.text(`life plugin: {side} build {BUILD}{keys}`))
    end)
end)
