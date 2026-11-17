--!strict
-- A port of `opencode-session-usage` 0.1.8 (`src/tui.tsx`): a sidebar panel with what the session in view and every
-- subagent session in its tree cost, at the provider's reported cost or at catalog prices, and the OpenCode Go usage
-- meters with their reset countdowns.
--
-- The total covers every message, not the loaded transcript: the panel walks the tree with `session.list` and pages
-- `message.list` for each session, through the host's `fetch`, after each turn in the tree as TS does. It reads the
-- meters with `usage.limits`, at most once per `refreshMs` and at once after a turn.
--
-- Where the native port differs: Luau has no thread, so the pages are read and priced on the UI thread, and no clock,
-- so the countdowns and the throttled read move only when the panel draws again; and it reads no config file.
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

-- The cursor of the page after `body`, if any.
local function cursorOf(body: any): string?
    local cursor = body and body.cursor and body.cursor.next
    return if type(cursor) == "string" and cursor ~= "" then cursor else nil
end

-- A page of `parent`'s children (TS `client.session.list`).
local function children(parent: string, cursor: string?): plugin.Fetch
    local query: { { string } } = { { "limit", tostring(PAGE_SIZE) }, { "parentID", parent } }
    if cursor then
        table.insert(query, { "cursor", cursor })
    end
    return { method = "GET", path = "/api/session", query = query }
end

-- A page of `session`'s messages (TS `client.message.list`).
local function messages(session: string, cursor: string?): plugin.Fetch
    local query: { { string } } = { { "limit", tostring(PAGE_SIZE) } }
    if cursor then
        table.insert(query, { "cursor", cursor })
    end
    return { method = "GET", path = `/api/session/{session}/message`, query = query }
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

return plugin.define(function(setup)
    local config = configure(setup.options)
    local at = { path = if config.position == "bottom" then "sidebar.footer" else "sidebar.content", kind = if config.position == "bottom" then "prepend" else "append" }

    -- TS `SidebarUsage`'s signals and variables, for the session of the latest mount.
    local mounts: { string } = {}
    local session: string? = nil
    local tree: { string } = {}
    local go: any = nil
    local limits: number? = nil
    local lastLoaded, lastForced = 0, 0
    local run: any = nil
    local queued: boolean? = nil
    local priced: { location: plugin.LocationRef?, sessions: { { plugin.SessionMessageInfo } } }? = nil
    local total: number? = nil
    local runs = 0

    -- TS `location()`: the session's location, else where the TUI works.
    local function location(read: plugin.Read)
        local info = session and read:session(session)
        return if info then { directory = info.info.location.directory } else read:info().location
    end

    -- TS `load`: the usage limits, at most once per `refreshMs`, and a forced read at most once a second.
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
        local query = { { "location[directory]", location(host).directory } }
        local id = host:fetch({ method = "GET", path = "/api/experimental/usage/limits", query = query })
        if id then
            limits = id
        else
            go = nil
        end
    end

    local refreshCost: (host: plugin.Host, reload: boolean) -> ()

    -- The run ended: when it read every page of the session still in view, its messages wait for the location's
    -- models to price them. Then a queued run starts.
    local function finish(host: plugin.Host, done: boolean)
        local ended = run
        run = nil
        if ended and done and session == ended.session then
            priced = { location = ended.location, sessions = ended.messages }
        end
        if queued ~= nil then
            local reload = queued
            queued = nil
            refreshCost(host, reload :: boolean)
        end
    end

    -- Fetches `fetch` for the run, waiting for `want`; false when the host did not take it.
    local function ask(host: plugin.Host, fetch: plugin.Fetch, want: any): boolean
        local id = host:fetch(fetch)
        if id then
            run.waiting[id] = want
        end
        return id ~= nil
    end

    -- Sends what the run needs next, or finishes it.
    local function step(host: plugin.Host)
        while run do
            if run.stage == "discover" then
                if next(run.waiting) ~= nil then
                    return
                end
                if run.at > 1 and run.at > #run.frontier then
                    run.frontier, run.nextDepth, run.at = run.nextDepth, {}, 1
                    run.depth += 1
                end
                if run.at == 1 and (run.depth >= MAX_DEPTH or #run.frontier == 0 or #run.ids >= MAX_SESSIONS) then
                    -- TS drops a tree found for a session no longer in view.
                    if session ~= run.session then
                        return finish(host, false)
                    end
                    tree = run.ids
                    run.stage, run.batch, run.open, run.messages = "price", 1, 0, {}
                elseif not ask(host, children(run.frontier[run.at]), { page = 0 }) then
                    return finish(host, false)
                else
                    return
                end
            else
                if run.open > 0 then
                    return
                end
                if run.batch > #run.ids then
                    return finish(host, true)
                end
                local last = math.min(run.batch + COST_CONCURRENCY - 1, #run.ids)
                for index = run.batch, last do
                    run.messages[index] = {}
                    if not ask(host, messages(run.ids[index]), { index = index, page = 0 }) then
                        return finish(host, false)
                    end
                end
                run.open, run.batch = last - run.batch + 1, last + 1
                return
            end
        end
    end

    -- TS `refreshCost`: one run at a time; a request during a run runs once it ends.
    refreshCost = function(host, reload: boolean)
        if run then
            queued = (queued or false) or reload
            return
        end
        if not session then
            return
        end
        runs += 1
        run = { id = runs, session = session, location = location(host), waiting = {} }
        if reload or #tree == 0 then
            local ids = family(host, session)
            run.stage, run.ids, run.frontier, run.at, run.listed, run.nextDepth, run.depth =
                "discover", ids, table.clone(ids), 1, {}, {}, 0
        else
            run.stage, run.ids, run.batch, run.open, run.messages = "price", table.clone(tree), 1, 0, {}
        end
        step(host)
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

    setup:onReply(function(host, id, body, failure)
        if id == limits then
            limits = nil
            -- A failed read hides the meters.
            go = if failure then nil else body and body.data and body.data.go
            return
        end
        local want = run and run.waiting[id]
        if not want then
            return
        end
        run.waiting[id] = nil
        -- A failed request ends the run and keeps the last total, as TS's `catch` does.
        if failure or not body then
            return finish(host, false)
        end
        local cursor = cursorOf(body)
        if want.index then
            local list = run.messages[want.index]
            for _, message in body.data or {} do
                table.insert(list, message)
            end
            if cursor and want.page + 1 < MAX_PAGES then
                if not ask(host, messages(run.ids[want.index], cursor), { index = want.index, page = want.page + 1 }) then
                    finish(host, false)
                end
                return
            end
            run.open -= 1
            return step(host)
        end
        for _, child in body.data or {} do
            table.insert(run.listed, child.id)
        end
        if cursor and want.page + 1 < MAX_PAGES and #run.listed < MAX_SESSIONS then
            if not ask(host, children(run.frontier[run.at], cursor), { page = want.page + 1 }) then
                finish(host, false)
            end
            return
        end
        for _, child in run.listed do
            if not table.find(run.ids, child) and #run.ids < MAX_SESSIONS then
                table.insert(run.ids, child)
                table.insert(run.nextDepth, child)
            end
        end
        run.listed = {}
        run.at += 1
        step(host)
    end)
end)
