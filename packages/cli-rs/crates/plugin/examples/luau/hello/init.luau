--!strict
-- `examples/hello` in Luau, line for line.
local plugin = require("@opencode/plugin")

return plugin.define(function(setup)
    -- A command in the palette and as `/hello`.
    setup:command({ name = "hello.greet", title = "Say hello", slash = "hello", palette = true }, function(host)
        host:toast({ variant = "success", message = "Hello from a plugin" })
    end)
    -- A line at the end of the home screen's footer; a click runs the command.
    setup:slot({ path = "home.footer" }, function()
        local text = plugin.text({ plugin.span("hello", { fg = "text.muted" }) }, { on_click = plugin.click("hello.greet") })
        return plugin.show(text)
    end)
end)
