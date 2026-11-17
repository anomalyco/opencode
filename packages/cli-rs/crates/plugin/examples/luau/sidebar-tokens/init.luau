--!strict
-- A port of `opencode-sidebar-tokens` 0.1.3 (`dist/tui.js`): a "Session tokens" block in the sidebar with the
-- session's input, output and cache totals, and its reasoning tokens when there are any. It follows the session's
-- info, so a `session.usage.updated` shows at once.
--
-- Options: `showReasoning = false` hides the reasoning row. TS formats with `Intl.NumberFormat(locale)`; the port
-- groups digits as `en-US` does, whatever `locale` says.
local plugin = require("@opencode/plugin")

-- `count` rounded to a whole number, its digits grouped in threes (`22,870`).
local function group(count: number): string
    local digits = tostring(math.round(count))
    local grouped = digits:reverse():gsub("(%d%d%d)", "%1,"):reverse()
    return if grouped:sub(1, 1) == "," then grouped:sub(2) else grouped
end

local function value(count: number?): string
    return if count and count == count and count >= 0 and count ~= math.huge then group(count) else "—"
end

-- TS `usageRows`: a label and its formatted count, `—` for a count the session lacks.
local function usage(tokens: plugin.TokenUsageInfo?, reasoning: boolean): { { string } }
    local cache = tokens and tokens.cache
    local rows = {
        { "Input", value(tokens and tokens.input) },
        { "Output", value(tokens and tokens.output) },
        { "Cache read", value(cache and cache.read) },
        { "Cache write", value(cache and cache.write) },
    }
    if reasoning and tokens and tokens.reasoning > 0 then
        table.insert(rows, { "Reasoning", value(tokens.reasoning) })
    end
    return rows
end

local function row(entry: { string })
    return plugin.row({
        plugin.text(entry[1], { fg = "text.muted" }),
        plugin.text(entry[2], { fg = "text.base", layout = { shrink = false } }),
    }, { justify = "space-between", gap = 1 })
end

return plugin.define(function(setup)
    local options = setup.options
    local reasoning = not (type(options) == "table" and options.showReasoning == false)
    setup:slot({ path = "sidebar.content" }, function(read, input, changed)
        local id = input.session_id
        if not id then
            return plugin.HIDE
        end
        if not (changed.all or table.find(changed.sessions or {}, id)) then
            return plugin.KEEP
        end
        local session = read:session(id)
        local rows = { plugin.text({ plugin.span("Session tokens", { bold = true }) }, { fg = "text.base" }) }
        for _, entry in usage(session and session.info.tokens, reasoning) do
            table.insert(rows, row(entry))
        end
        -- TS shows it while the session's first sync runs; the host loads it.
        if not session then
            table.insert(rows, plugin.text("Loading…", { fg = "text.muted" }))
        end
        return plugin.show(plugin.column(rows, { layout = { margin = { top = 1 }, shrink = false } }))
    end)
end)
