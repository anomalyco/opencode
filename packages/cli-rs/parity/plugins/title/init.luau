--!strict
-- The P0b title plugin for opencode-native: `/p0btitle` and `/p0blong` set the terminal title, and `/p0brun` and
-- `/p0btwice` run their input with `sh -c`, once or twice at once. How each program ended becomes the title, which a
-- terminal's title log keeps where a later toast replaces an earlier one, and a toast.
local plugin = require("@opencode/plugin")

return plugin.define(function(setup)
    local function command(name: string, title: string, slash: string, arguments: boolean?): plugin.CommandSpec
        return { name = name, title = title, group = "Sample", slash = slash, palette = true, arguments = arguments }
    end
    local function report(host: plugin.Host, text: string)
        host:setTitle(text)
        host:toast({ variant = "info", message = text })
    end
    setup:command(command("p0b.title", "Set the title", "p0btitle"), function(host)
        host:setTitle("p0b title")
    end)
    setup:command(command("p0b.long", "Set a long title", "p0blong"), function(host)
        host:setTitle("p0b long " .. string.rep("é", 3000))
    end)
    -- Each run is a task of its own, so the second of `/p0btwice` asks while the first program runs.
    local function run(name: string, times: number)
        setup:command(command("p0b." .. name, "Run a program", name, true), function(host, input)
            for _ = 1, times do
                plugin.spawn(function()
                    local ended, err = host:foreground({ command = "sh", args = { "-c", input or "" } })
                    if ended then
                        report(host, "p0b exit " .. plugin.json.encode(ended))
                    else
                        report(host, "p0b error " .. (err or "no reason"))
                    end
                end)
            end
        end)
    end
    run("p0brun", 1)
    run("p0btwice", 2)
end)
