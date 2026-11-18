--!strict
-- A port of `opencode-subagents-sidebar` 0.1.6 (`src/tui.tsx`): the direct subagent sessions of the session in view,
-- newest activity first, in the sidebar. A green dot marks a running child. A row opens its child, the header folds
-- the list and remembers it, and `/subagents` picks a child from a list. A session without children draws nothing.
-- The sidebar shows ten children at most; the header keeps the count and a `+N more` row says what was left out.
local plugin = require("@opencode/plugin")

local VISIBLE = 10
local OPEN = "subagents-sidebar.open"
local TOGGLE = "subagents-sidebar.toggle"
-- TS `theme.text.feedback.success.base` and `theme.text.muted`.
local GREEN = "text.feedback.success.base"
local DIM = "text.muted"

type Child = { id: string, title: string, running: boolean }

-- The direct children of `session`, last updated first; equal times keep the host's order.
local function children(read: plugin.Read, session: string): { Child }
    type Entry = { member: plugin.Member, index: number }
    local members: { Entry } = {}
    for index, member in read:family(session).members do
        if member.parent == session then
            table.insert(members, { member = member, index = index })
        end
    end
    table.sort(members, function(a: Entry, b: Entry): boolean
        if a.member.updated ~= b.member.updated then
            return a.member.updated > b.member.updated
        end
        return a.index < b.index
    end)
    local list = {}
    for _, entry in members do
        local info = read:session(entry.member.id)
        local title = info and info.info.title
        table.insert(list, {
            id = entry.member.id,
            title = if title and title ~= "" then title else "Subagent",
            running = entry.member.status == "running",
        })
    end
    return list
end

-- Whether the list is unfolded: the stored `view`, open at first.
local function open(read: plugin.Read): boolean
    local view = read:storageGet("view")
    return not (type(view) == "table" and view.open == false)
end

local function row(child: Child)
    return plugin.row({
        plugin.text("•", { fg = if child.running then GREEN else DIM, layout = { shrink = false } }),
        plugin.text(child.title, {
            fg = "text.base",
            wrap = "none",
            truncate = true,
            layout = { grow = true, shrink = true, min_width = { cells = 0 } },
        }),
        plugin.text(if child.running then "running" else "done", { fg = DIM, wrap = "none", layout = { shrink = false } }),
    }, {
        gap = 1,
        layout = { min_width = { cells = 0 } },
        on_click = { action = plugin.command(OPEN, child.id), on = "down" },
    })
end

local function sidebar(list: { Child }, unfolded: boolean)
    local running = 0
    for _, child in list do
        if child.running then
            running += 1
        end
    end
    local title = { plugin.span("Subagents", { bold = true }) }
    if not unfolded then
        local busy = if running > 0 then `, {running} running` else ""
        table.insert(title, plugin.span(` ({#list}{busy})`, { fg = DIM }))
    end
    local header = plugin.row({
        plugin.text(if unfolded then "▼" else "▶", { fg = "text.base" }),
        plugin.text(title, { fg = "text.base" }),
    }, { gap = 1, on_click = { action = plugin.command(TOGGLE), on = "down" } })
    local rows = { header }
    if unfolded then
        for index = 1, math.min(#list, VISIBLE) do
            table.insert(rows, row(list[index]))
        end
        if #list > VISIBLE then
            table.insert(rows, plugin.text(`+{#list - VISIBLE} more`, { fg = DIM }))
        end
    end
    return plugin.column(rows)
end

return plugin.define(function(setup)
    setup:storageKey("view")
    -- The sessions of the mounted sidebars, latest last: TS registers `/subagents` in the sidebar component, so it
    -- picks from the session that sidebar shows.
    local mounted: { string } = {}
    setup:command({
        name = "subagents-sidebar.pick",
        title = "Subagents: open one",
        group = "Session",
        slash = "subagents",
        palette = true,
    }, function(host)
        local session = mounted[#mounted]
        local list = session and children(host, session) or {}
        if #list == 0 then
            return
        end
        local options = {}
        for _, child in list do
            table.insert(options, {
                title = child.title,
                value = child.id,
                description = if child.running then "running" else "done",
            })
        end
        host:dialog({ type = "select", title = "Subagents", options = options, action = plugin.command(OPEN) })
    end)
    -- Route navigation, as the TS plugin does: the built-in session list navigates this way too.
    setup:command({ name = OPEN }, function(host, id)
        if id then
            host:navigate({ type = "session", id = id })
        end
    end)
    setup:command({ name = TOGGLE }, function(host)
        host:storageMerge("view", { open = not open(host) })
    end)
    local at: plugin.At = { path = "sidebar.content" }
    setup:slot(at, function(read, input, changed)
        local session = input.session_id
        if not session then
            return plugin.HIDE
        end
        -- Children come and go, and change, with session infos and statuses; the fold is in storage.
        if not (changed.all or changed["local"] or changed.woken or changed.sessions) then
            return plugin.KEEP
        end
        local list = children(read, session)
        if #list == 0 then
            return plugin.HIDE
        end
        return plugin.show(sidebar(list, open(read)))
    end)
    setup:onMount(at, function(_, input, isMounted)
        local session = input.session_id
        if not session then
            return
        end
        if isMounted then
            table.insert(mounted, session)
            return
        end
        for index = #mounted, 1, -1 do
            if mounted[index] == session then
                table.remove(mounted, index)
                break
            end
        end
    end)
end)
