--!strict
-- `examples/force-input` in Luau: `ctrl+enter` (and `ctrl+return`) interrupts the running session and sends the
-- prompt, as `session.interrupt` three times and then `prompt.submit`. A hint in the prompt footer says what enter
-- does: `⏎ send` while the session is idle, `⏎ steer · ctrl+⏎ interrupt & send` while it runs; none in shell mode, on
-- the home screen, or with the option `"hint": false`.
local plugin = require("@opencode/plugin")

local INTERRUPT = "session.interrupt"
-- The keys terminals send for Ctrl+Enter, each bound by a command of its own.
local BINDS = {
    { "ctrl+return", "oc-ctrl-enter.force-submit.return" },
    { "ctrl+enter", "oc-ctrl-enter.force-submit.enter" },
}
-- TS `resolveHintColors` on the current theme: the force action, the key, and the label.
local FORCE = "text.action.primary.base"
local KEY = "text.base"
local LABEL = "text.muted"

local function forceSubmit(host)
    host:dispatch(INTERRUPT)
    host:dispatch(INTERRUPT)
    host:dispatch(INTERRUPT)
    host:dispatch("prompt.submit")
end

return plugin.define(function(setup)
    -- Only an explicit `false` hides the hint.
    local options = setup.options
    local hint = not (type(options) == "table" and options.hint == false)
    for _, bind in BINDS do
        setup:command(
            { name = bind[2], title = "Force submit prompt", group = "Prompt", keybind = bind[1] },
            forceSubmit
        )
    end
    setup:slot({ path = "prompt.footer.status" }, function(read, input, changed)
        local prompt, session = input.prompt, input.session_id
        if not prompt or not session or not hint or prompt.shell then
            return plugin.HIDE
        end
        if not (changed.all or table.find(changed.sessions or {}, session)) then
            return plugin.KEEP
        end
        local info = read:session(session)
        if not info then
            return plugin.HIDE
        end
        local spans = if info.status == "running"
            then {
                plugin.span("⏎ "),
                plugin.span("steer · ", { fg = LABEL }),
                plugin.span("ctrl+⏎", { fg = FORCE }),
                plugin.span(" interrupt & send", { fg = LABEL }),
            }
            else { plugin.span("⏎ "), plugin.span("send", { fg = LABEL }) }
        return plugin.show(plugin.text(spans, { fg = KEY, wrap = "none", layout = { shrink = false } }))
    end)
end)
