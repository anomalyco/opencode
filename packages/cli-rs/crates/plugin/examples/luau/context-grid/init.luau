--!strict
-- A port of `@khaosoigai/oc-context-grid` 0.3.2 (`dist/index.js`): how full the session's context window is, as a
-- grid of squares colored by an estimate of what filled it (system, user, assistant, tools, other), in the sidebar
-- and on a page of its own, `/contextgrid`, which escape leaves for the session it was opened from.
--
-- Options: `sidebar = false` leaves the sidebar's grid out. TS's slash alias `/ctx` has no port: a command has one
-- slash name (the JS host drops it too).
local plugin = require("@opencode/plugin")
local context = require("@self/context")

local ROUTE = "contextgrid"
local MODE = "oc-context-grid"

-- TS `getContextData` for `session`, from what the host has loaded.
local function data(read: plugin.Read, session: string)
    local info = read:session(session)
    return context.data(read:messages(session), info and info.info, read:models() or {})
end

-- TS `Grid`: rows of ten squares, each its glyph and a space in its category's color.
local function squares(found: context.Context, total: number)
    local rows = {}
    local grid = if found.limit > 0 then context.grid(found.segments, found.limit, total) else {}
    for index, square in grid do
        local row = (index - 1) // 10 + 1
        rows[row] = rows[row] or {}
        table.insert(rows[row], plugin.span(square[2] .. " ", { fg = context.COLOR[square[1]] }))
    end
    local nodes = {}
    for _, spans in rows do
        table.insert(nodes, plugin.text(spans))
    end
    return nodes
end

-- TS `MiniGrid`: the sidebar's grid of 30 squares.
local function mini(read: plugin.Read, session: string)
    local rows = { plugin.text({ plugin.span("Context grid", { bold = true }) }, { fg = "text.base" }) }
    local found = data(read, session)
    if not found then
        table.insert(rows, plugin.text("no usage yet", { fg = "text.muted" }))
    else
        local summary = `{context.tokens(found.tokens)}/{context.tokens(found.limit)} tokens ({context.js(found.percent or 0)}%)`
        table.insert(rows, plugin.text(summary, { fg = "text.muted" }))
        for _, row in squares(found, 30) do
            table.insert(rows, row)
        end
    end
    return plugin.column(rows)
end

-- TS `FullView`: the page, with its grid of 100 squares and the estimate by category.
local function full(read: plugin.Read, session: string?)
    local rows = { plugin.text({ plugin.span("Context Usage", { bold = true }) }, { fg = "text.base" }) }
    local found = session and data(read, session)
    if not found then
        local empty = if session then "No usage yet — send a message first." else "No session selected."
        table.insert(rows, plugin.text(empty, { fg = "text.muted" }))
    else
        local summary = `{found.model} · {context.tokens(found.tokens)}/{context.tokens(found.limit)} tokens `
            .. `({context.js(found.percent or 0)}%) · {context.cost(found.cost)} spent`
        table.insert(rows, plugin.text(summary, { fg = "text.muted" }))
        local legend = { plugin.text("Estimated usage by category", { fg = "text.muted" }) }
        for _, segment in found.segments do
            local share = `{context.tokens(segment.tokens)} tokens ({context.percentOf(segment.tokens, found.limit)}%)`
            table.insert(legend, plugin.text({
                plugin.span(context.GLYPH_FULL .. " ", { fg = context.COLOR[segment.key] }),
                plugin.span(context.LABEL[segment.key] .. ": ", { fg = "text.base" }),
                plugin.span(share, { fg = "text.muted" }),
            }))
        end
        local free = if found.limit > 0 then math.max(0, found.limit - found.tokens) else 0
        if free > 0 then
            table.insert(legend, plugin.text({
                plugin.span(context.GLYPH_FREE .. " ", { fg = context.COLOR.free }),
                plugin.span("Free space: ", { fg = "text.base" }),
                plugin.span(`{context.tokens(free)} ({context.percentOf(free, found.limit)}%)`, { fg = "text.muted" }),
            }))
        end
        table.insert(rows, plugin.row({
            plugin.column(squares(found, 100), { layout = { shrink = false } }),
            plugin.column(legend),
        }, { gap = 2 }))
    end
    table.insert(rows, plugin.text("esc close", { fg = "text.muted" }))
    return plugin.column(rows, { padding = { 1, 1 }, gap = 1 })
end

return plugin.define(function(setup)
    local options = setup.options
    if not (type(options) == "table" and options.sidebar == false) then
        setup:slot({ path = "sidebar.content" }, function(read, input, changed)
            local session = input.session_id
            if not session then
                return plugin.HIDE
            end
            local touched = changed.all
                or changed.locations
                or table.find(changed.sessions or {}, session)
                or table.find(changed.lists or {}, session)
            if not touched then
                return plugin.KEEP
            end
            return plugin.show(mini(read, session))
        end)
    end
    -- The session the page was opened from: what it shows, and where escape goes back to.
    local origin: string? = nil
    setup:command({
        name = "oc-context-grid.open",
        title = "Context Grid",
        group = "Plugin",
        description = "Show context usage as a grid of squares",
        palette = true,
        slash = ROUTE,
    }, function(host)
        local route = host:route()
        origin = if route.type == "session" then route.id else nil
        host:openRoute(ROUTE)
    end)
    setup:surface({ name = ROUTE, place = { type = "route", name = ROUTE }, mounts = true }, function(view)
        return full(view.read, origin)
    end, function(host, event)
        -- TS pushes its keyboard mode while the page shows.
        if event.type == "mount" then
            host:setMode(if event.mounted then MODE else nil)
        end
        return "pass"
    end)
    setup:layer({
        scope = "global",
        mode = MODE,
        keys = { { key = "escape", name = "close", title = "Close context grid" } },
    }, function(host)
        host:navigate(if origin then { type = "session", id = origin } else { type = "home" })
        return "consume"
    end)
end)
