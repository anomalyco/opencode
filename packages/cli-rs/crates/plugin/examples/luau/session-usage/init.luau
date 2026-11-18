--!strict
-- A port of `opencode-session-usage` 0.1.8 (`src/tui.tsx`): a sidebar panel with what the session in view and every
-- subagent session in its tree cost, at the provider's reported cost or at catalog prices, and the OpenCode Go usage
-- meters with their reset countdowns.
--
-- The total covers every message, not the loaded transcript: the panel walks the tree with `session.list` and pages
-- `message.list` for each session, through the host's `fetch`, after each turn in the tree as TS does. It reads the
-- meters with `usage.limits`, at most once per `refreshMs` and at once after a turn. While a panel shows, it ticks every
-- 15 seconds on the host's clock (`plugin.every`), which moves the countdowns and lets the throttled read run.
--
-- Where the native port differs: Luau has no thread, so the pages are read and priced on the UI thread; and it reads
-- no config file.
local plugin = require("@opencode/plugin")
local usage = require("@self/usage")
local configure = require("@self/config")

local MAX_SESSIONS = 500
local PAGE_SIZE = 100
local MAX_PAGES = 100
local MAX_DEPTH = 10
local COST_CONCURRENCY = 4

-- `Date.now()`, to the second.
local function now(): number
    return os.time() * 1000
end

-- The cursor of the page after `next`, if any.
local function cursorOf(next: string?): string?
    return if next ~= "" then next else nil
end

-- TS `familyIDs`: every session the host knows in the tree of `session`, the root first.
local function family(read: plugin.Read, session: string): { string }
    local roots, rest = {}, {}
    for _, member in read:family(session).members do
        table.insert(if member.parent then rest else roots, member.id)
    end
    table.move(rest, 1, #rest, #roots + 1, roots)
    return if #roots > 0 then roots else { session }
end

-- TS `fetchMessages`: every message of `session`, page by page; `nil` once a request failed, or once `run` failed.
local function fetchMessages(session: string, run: { failed: boolean }): { plugin.SessionMessageInfo }?
    local list: { plugin.SessionMessageInfo }, cursor: string? = {}, nil
    for _ = 1, MAX_PAGES do
        local page = plugin.client.message.list({ sessionID = session, limit = PAGE_SIZE, cursor = cursor })
        if not page or run.failed then
            return nil
        end
        table.move(page.data, 1, #page.data, #list + 1, list)
        cursor = cursorOf(page.cursor.next)
        if not cursor then
            break
        end
    end
    return list
end

-- TS `costOfSessions`' reads: the messages of each of `ids`, `COST_CONCURRENCY` sessions at a time; `nil` once a
-- request failed, which stops the other sessions of its batch at their next page.
local function fetchAll(ids: { string }): { { plugin.SessionMessageInfo } }?
    local sets, run = {}, { failed = false }
    for first = 1, #ids, COST_CONCURRENCY do
        local batch = {}
        for index = first, math.min(first + COST_CONCURRENCY - 1, #ids) do
            table.insert(batch, function(): (any, any)
                local list = fetchMessages(ids[index], run)
                run.failed = run.failed or list == nil
                return list, if list then nil else "failed"
            end)
        end
        local lists = plugin.all(batch)
        if not lists then
            return nil
        end
        table.move(lists, 1, #lists, #sets + 1, sets)
    end
    return sets
end

-- TS `familyIDs`' walk down: the children of each session of `ids`, level by level, added to `ids`; `false` once a
-- request failed.
local function discover(ids: { string }): boolean
    local frontier, depth = table.clone(ids), 0
    while depth < MAX_DEPTH and #frontier > 0 and #ids < MAX_SESSIONS do
        local found = {}
        for _, parent in frontier do
            local listed: { string }, cursor: string? = {}, nil
            for page = 1, MAX_PAGES do
                local sessions = plugin.client.session.list({ limit = PAGE_SIZE, parentID = parent, cursor = cursor })
                if not sessions then
                    return false
                end
                for _, child in sessions.data do
                    table.insert(listed, child.id)
                end
                cursor = cursorOf(sessions.cursor.next)
                if not cursor or page >= MAX_PAGES or #listed >= MAX_SESSIONS then
                    break
                end
            end
            for _, child in listed do
                if not table.find(ids, child) and #ids < MAX_SESSIONS then
                    table.insert(ids, child)
                    table.insert(found, child)
                end
            end
        end
        frontier, depth = found, depth + 1
    end
    return true
end

return plugin.define(function(setup)
    local config = configure(setup.options)
    local at = { path = if config.position == "bottom" then "sidebar.footer" else "sidebar.content", kind = if config.position == "bottom" then "prepend" else "append" }

    -- TS `SidebarUsage`'s signals and variables, for the session of the latest mount.
    local mounts: { string } = {}
    local session: string? = nil
    local tree: { string } = {}
    local go: any = nil
    local limits = false
    local lastLoaded, lastForced = 0, 0
    local running = false
    -- The tick runs: it ends at its first tick with no panel mounted.
    local ticking = false
    local queued: boolean? = nil
    local priced: { location: plugin.LocationRef?, sessions: { { plugin.SessionMessageInfo } } }? = nil
    local total: number? = nil

    -- TS `location()`: the session's location, else where the TUI works.
    local function location(read: plugin.Read): plugin.LocationRef
        local info = session and read:session(session)
        return if info then { directory = info.info.location.directory } else read:info().location
    end

    -- TS `load`: the usage limits, at most once per `refreshMs`, and a forced read at most once a second. A failed read
    -- hides the meters.
    local function load(host: plugin.Host, force: boolean)
        local time = now()
        if limits or (not force and (config.refreshMs == 0 or time - lastLoaded < config.refreshMs)) then
            return
        end
        if force and time - lastForced < 1000 then
            return
        end
        lastLoaded = time
        if force then
            lastForced = time
        end
        limits = true
        plugin.spawn(function()
            local read = plugin.client.experimental.usage.limits({ location = { directory = location(host).directory } })
            limits = false
            go = read and read.data and read.data.go
        end)
    end

    -- One run: the tree when it is new or asked again, then every message of it. When it read every page of the session
    -- still in view, its messages wait for the location's models to price them. A failed request keeps the last total,
    -- as TS's `catch` does.
    local function cost(host: plugin.Host, reload: boolean)
        local current, where = session :: string, location(host)
        local ids = table.clone(tree)
        if reload or #tree == 0 then
            ids = family(host, current)
            -- TS drops a tree found for a session no longer in view.
            if not discover(ids) or session ~= current then
                return
            end
            tree = ids
        end
        local sets = fetchAll(ids)
        if sets and session == current then
            priced = { location = where, sessions = sets }
        end
    end

    -- TS `refreshCost`: one run at a time; a request during a run runs once it ends.
    local function refreshCost(host: plugin.Host, reload: boolean)
        if running then
            queued = (queued or false) or reload
            return
        end
        if not session then
            return
        end
        running = true
        plugin.spawn(function()
            local again: boolean? = reload
            while again ~= nil and session do
                cost(host, again)
                again, queued = queued, nil
            end
            running = false
        end)
    end

    -- TS `touchesTree`.
    local function touches(id: string): boolean
        return session == id or table.find(tree, id) ~= nil
    end

    setup:slot(at, function(read, input, changed)
        if not input.session_id then
            return plugin.HIDE
        end
        local pricing = priced ~= nil and (changed.all or changed.locations ~= nil)
        if not (changed.all or changed.woken or changed["local"] or pricing) then
            return plugin.KEEP
        end
        if priced then
            local models = read:models(priced.location)
            if models then
                local sum = 0
                for _, list in priced.sessions do
                    sum += usage.sessionCost(list, models)
                end
                total, priced = sum, nil
            end
        end
        local estimate = if total then usage.money(total) else "…"
        if config.compact then
            local line = ""
            if go and config.showMeters then
                line = `R{usage.round(go.rolling.percent)}% · W{usage.round(go.weekly.percent)}% · M{usage.round(go.monthly.percent)}%`
            elseif config.showEstimate then
                line = `≈ {estimate}`
            end
            return plugin.show(plugin.column({ plugin.text(`{config.title} · {line}`, { fg = "text.base" }) }))
        end
        local rows = { plugin.text(config.title, { fg = "text.base" }) }
        if config.showEstimate then
            table.insert(rows, plugin.text(`≈ {estimate} session total`, { fg = "text.muted" }))
        end
        if go and config.showMeters then
            -- A leading empty box and the gap stand for TS `paddingTop={1}`.
            local meters = if config.showEstimate then { plugin.column({}) } else {}
            local time = now()
            for _, meter in { { "Rolling", go.rolling }, { "Weekly", go.weekly }, { "Monthly", go.monthly } } do
                local color = usage.color(meter[2].percent, meter[2].limited, config.warnAt, config.criticalAt)
                local percent = string.format("%4s used", `{usage.round(meter[2].percent)}%`)
                local reset = if config.showReset then ` · resets {usage.resetIn(meter[2].resetsAt, time)}` else ""
                local lines = {
                    plugin.text({
                        plugin.span(string.format("%-8s", meter[1]), { fg = "text.base" }),
                        plugin.span(percent, { fg = color }),
                        plugin.span(reset, { fg = "text.muted" }),
                    }, { wrap = "none" }),
                }
                if config.showBars then
                    local filled = usage.filled(meter[2].percent, config.barWidth)
                    table.insert(lines, plugin.text({
                        plugin.span(string.rep("━", filled), { fg = color }),
                        plugin.span(string.rep("─", config.barWidth - filled), { fg = "text.muted" }),
                    }, { wrap = "none" }))
                end
                table.insert(meters, plugin.column(lines))
            end
            table.insert(rows, plugin.column(meters, { gap = 1 }))
        end
        return plugin.show(plugin.column(rows))
    end)

    -- A mount for another session starts over for it, as TS does when `sessionID` changes; a mount for the same one
    -- reads the limits again, as a new TS component does.
    setup:onMount(at, function(host, input, mounted)
        local id = input.session_id
        if not id then
            return
        end
        if not mounted then
            for index = #mounts, 1, -1 do
                if mounts[index] == id then
                    table.remove(mounts, index)
                    break
                end
            end
            return
        end
        table.insert(mounts, id)
        -- TS's tick: the countdowns move as the panel draws again after it, and the throttled read may run.
        if not ticking then
            ticking = true
            plugin.every(usage.TICK_MS, function(host)
                if #mounts == 0 then
                    ticking = false
                    return false
                end
                load(host, false)
                return true
            end)
        end
        if session == id then
            return load(host, true)
        end
        session, tree, priced, total = id, {}, nil, nil
        refreshCost(host, true)
        load(host, true)
    end)

    setup:onEvent({ "session.execution.succeeded", "session.usage.updated", "session.created", "session.deleted" }, function(host, event)
        if #mounts == 0 then
            return
        end
        if event.type == "session.execution.succeeded" or event.type == "session.usage.updated" then
            if touches(event.data.sessionID) then
                refreshCost(host, false)
                load(host, true)
            end
        elseif event.type == "session.created" then
            local parent = event.data.parentID
            if not parent or not touches(parent) then
                return
            end
            if not table.find(tree, event.data.sessionID) then
                table.insert(tree, event.data.sessionID)
            end
            refreshCost(host, false)
            load(host, true)
        elseif event.type == "session.deleted" then
            local index = table.find(tree, event.data.sessionID)
            if index then
                table.remove(tree, index)
                refreshCost(host, false)
            end
        end
    end)

end)
