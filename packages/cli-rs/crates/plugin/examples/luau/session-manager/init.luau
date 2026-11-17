--!strict
-- A port of `@0xuwui/opencode-session-manager` 0.1.2 (`src/tui.tsx`, `src/panel.tsx`): `/session-manager` opens a page
-- of every session, grouped by directory, project, or when they were created, updated or viewed, with their
-- subsessions as a tree; the keys move a selection through it, fold groups, search in a field, rename a session and
-- delete one or a whole group, each after asking. The grouping, the subsessions and the language are kept.
--
-- Where it differs from TS: the rename prompt cannot be filled with the session's title or show its directory (a
-- prompt has a title and a placeholder only); the search field never takes the focus from `/` (the host refuses a
-- field its tree does not hold yet, and a Luau plugin has no wake to ask again once it does), so only a click focuses
-- it; a refresh after a session event runs at once, as Luau has no timer for TS's 300 ms; paths keep the home
-- directory, which a Luau plugin cannot read; and `/sm` is not there.
local plugin = require("@opencode/plugin")
local grouping = require("@self/grouping")
local i18n = require("@self/i18n")

local ROUTE = "manager"
local SETTINGS = "settings"
local ROWS = "session-manager-rows"
local SEARCH = "session-manager-search"
local PAGE_SIZE = 200

-- What each key of the page's two layers does: the list's while no search is typed, the search's while one is.
local LIST_KEYS = {
    { "up", "up" }, { "k", "up" }, { "down", "down" }, { "j", "down" }, { "pageup", "page-up" },
    { "pagedown", "page-down" }, { "home", "first" }, { "g", "first" }, { "end", "last" }, { "shift+g", "last" },
    { "return", "open" }, { "space", "fold" }, { "tab", "next-mode" }, { "shift+tab", "previous-mode" },
    { "c", "children" }, { "r", "rename" }, { "d", "delete" }, { "shift+d", "delete-group" }, { "f5", "refresh" },
    { "shift+r", "refresh" }, { "/", "search" }, { "ctrl+f", "search" }, { "l", "language" }, { "escape", "back" },
    { "q", "back" },
}
local SEARCH_KEYS = {
    { "up", "up" }, { "down", "down" }, { "pageup", "page-up" }, { "pagedown", "page-down" }, { "return", "finish" },
    { "tab", "finish" }, { "escape", "clear" },
}
local HINT_KEYS = { "↑↓", "Enter", "Tab", "c", "r", "d", "D", "/", "F5", "l", "Esc" }

type Row = grouping.Row

-- TS `SessionManagerPage`'s signals.
local state = {
    origin = nil :: string?,
    from = nil :: string?,
    sessions = {} :: { grouping.Session },
    pages = {} :: { grouping.Session },
    projects = {} :: { [string]: string },
    loading = true,
    error = nil :: string?,
    busy = false,
    collapsed = {} :: { [string]: boolean },
    selected = nil :: string?,
    last = 1,
    now = 0,
    query = "",
    searching = false,
    mode = "directory",
    children = false,
    locale = "en",
}
-- How many times the page mounted, and the refresh whose reads count: a flow that waited goes on only while its page
-- and its refresh are the current ones.
local mounts, reads = 0, 0

local function t(): i18n.Messages
    return i18n.messages[state.locale]
end

local function modeIndex(mode: string): number
    return table.find(grouping.MODES, mode) or 1
end

-- What the page lists now: its groups and their rows.
local function listed()
    local function text(session: grouping.Session): string
        return `{session.title or ""} {session.location.directory} {session.location.directory}`
    end
    local shown = grouping.filter(state.sessions, state.query, text, state.children)
    local function label(key: string): string
        if state.mode == "directory" then
            return key
        elseif state.mode == "project" then
            return if key == "global" then t().noProject else (state.projects[key] or key)
        end
        return t().buckets[tonumber(key) :: number]
    end
    local groups = grouping.groups(shown, state.mode, state.children, state.now, label)
    return groups, grouping.rows(groups, state.collapsed)
end

local function keyOf(row: Row): string
    return if row.type == "group" then `g:{row.group.key}` else `s:{row.session.id}`
end

-- TS `index`: the selected row, else the one at the last index.
local function indexOf(rows: { Row }): number?
    if #rows == 0 then
        return nil
    end
    for index, row in rows do
        if keyOf(row) == state.selected then
            return index
        end
    end
    return math.min(state.last, #rows)
end

local function rowId(index: number): string
    return `session-manager-row-{index - 1}`
end

-- TS `select`, and the scroll that keeps it in view (`scrollChildIntoView`).
local function select(host: plugin.Host, rows: { Row }, target: number)
    if #rows == 0 then
        return
    end
    local clamped = math.clamp(target, 1, #rows)
    state.last = clamped
    state.selected = keyOf(rows[clamped])
    host:scroll(
        { type = "node", surface = ROUTE, id = ROWS },
        { type = "to", node = rowId(clamped), align = { type = "nearest" } }
    )
end

local function page(cursor: string?): plugin.Fetch
    local query: { { string } } = { { "limit", tostring(PAGE_SIZE) }, { "order", "desc" } }
    if cursor then
        table.insert(query, { "cursor", cursor })
    end
    return { method = "GET", path = "/api/session", query = query }
end

-- The list is read: TS's `setSessions` with the selection on the session it came from.
local function finished()
    state.sessions = state.pages
    state.pages = {}
    if not state.selected and state.from then
        state.selected = `s:{state.from}`
    end
    state.now = os.time() * 1000
    state.error = nil
    state.loading = false
end

-- TS `refresh`: every page of the session list, and the projects, side by side. A later refresh drops what this one
-- still reads, and a failed read drops the other.
local function refresh(host: plugin.Host)
    reads += 1
    local this, left = reads, 2
    state.pages = {}
    local function done(failure: string?)
        if failure then
            reads += 1
            state.error, state.loading = failure, false
            return
        end
        left -= 1
        if left == 0 then
            finished()
        end
    end
    plugin.spawn(function()
        local cursor: string? = nil
        repeat
            local body, failure = host:fetch(page(cursor))
            if reads ~= this then
                return
            elseif failure then
                return done(failure)
            end
            local data = body and body.data or {}
            for _, session in data do
                table.insert(state.pages, session)
            end
            local next = body and body.cursor and body.cursor.next
            cursor = if type(next) == "string" and next ~= "" and #data > 0 then next else nil
        until not cursor
        done(nil)
    end)
    plugin.spawn(function()
        local body, failure = host:fetch({ method = "GET", path = "/api/project" })
        if reads ~= this then
            return
        elseif failure then
            return done(failure)
        end
        local list = if body and body.data then body.data else (body or {})
        state.projects = {}
        for _, project in list do
            local name = type(project.name) == "string" and project.name:match("^%s*(.-)%s*$")
            state.projects[project.id] = if name and name ~= "" then name else (project.canonical or "")
        end
        done(nil)
    end)
end

-- TS's mount: a new page, with the stored settings, which reads the sessions.
local function mount(host: plugin.Host)
    local stored = host:storageGet(SETTINGS)
    stored = if type(stored) == "table" then stored else {}
    local mode = if table.find(grouping.MODES, stored.mode) then stored.mode else "directory"
    local locale = if i18n.messages[stored.locale] then stored.locale else "en"
    local origin = state.origin
    for key in state :: any do
        (state :: any)[key] = nil
    end
    state.origin, state.from, state.sessions, state.pages, state.projects = origin, origin, {}, {}, {}
    state.loading, state.busy, state.collapsed, state.last, state.now = true, false, {}, 1, os.time() * 1000
    state.query, state.searching, state.mode, state.children, state.locale =
        "", false, mode, stored.showChildren == true, locale
    mounts += 1
    refresh(host)
end

-- TS `persist`, as its store writes it: the fields that differ from what is stored, or from the defaults.
local function persist(host: plugin.Host)
    local stored = host:storageGet(SETTINGS)
    local base = if type(stored) == "table" then stored else { mode = "directory", showChildren = false, locale = "en" }
    local draft: { [string]: any } = { mode = state.mode, showChildren = state.children, locale = state.locale }
    local fields, any = {}, false
    for key, value in draft do
        if base[key] ~= value then
            fields[key], any = value, true
        end
    end
    if any then
        host:storageMerge(SETTINGS, fields)
    end
end

local function fold(key: string)
    state.collapsed[key] = if state.collapsed[key] then nil else true
end

-- TS `activate`: a group folds, a session opens.
local function activate(host: plugin.Host, rows: { Row })
    local index = indexOf(rows)
    local row = index and rows[index]
    if not row then
        return
    end
    if row.type == "group" then
        fold(row.group.key)
    else
        host:navigate({ type = "session", id = row.session.id })
    end
end

-- TS `back`: the session it was opened from, while it exists, else home.
local function back(host: plugin.Host)
    for _, session in state.sessions do
        if session.id == state.from then
            return host:navigate({ type = "session", id = session.id })
        end
    end
    host:navigate({ type = "home" })
end

local function setMode(host: plugin.Host, mode: string)
    state.collapsed = {}
    state.mode = mode
    persist(host)
end

local function stepMode(host: plugin.Host, delta: number)
    setMode(host, grouping.MODES[(modeIndex(state.mode) - 1 + delta) % #grouping.MODES + 1])
end

local function toggleChildren(host: plugin.Host)
    state.children = not state.children
    persist(host)
end

local function setLocale(host: plugin.Host, locale: string)
    state.locale = locale
    persist(host)
end

-- TS `startSearch`. The field shows with this call's view, after the focus is refused: see the header.
local function startSearch(host: plugin.Host)
    state.searching = true
    host:focus(SEARCH)
end

local function finishSearch(host: plugin.Host)
    state.searching = false
    host:blur()
end

local function clearSearch(host: plugin.Host)
    state.query = ""
    finishSearch(host)
end

-- A confirm with its own labels: whether it was confirmed.
local function confirm(host: plugin.Host, title: string, lines: { string }, yes: string, no: string): boolean
    local message = table.concat(lines, "\n")
    return host:confirm({ title = title, message = message, label = { confirm = yes, cancel = no } }) == true
end

-- TS `rename`: a prompt for the selected session's new title, then the rename. The page takes no keys meanwhile.
local function rename(host: plugin.Host, rows: { Row })
    local index = indexOf(rows)
    local row = index and rows[index]
    if not row or row.type ~= "session" then
        return
    end
    local id, opened = row.session.id, mounts
    state.busy = true
    local text = host:prompt({ title = t().renameTitle, placeholder = row.session.title or "" })
    local title = (text or ""):match("^%s*(.-)%s*$") :: string
    local current
    for _, session in state.sessions do
        if session.id == id then
            current = session.title
        end
    end
    if mounts ~= opened or title == "" or title == current then
        state.busy = false
        return
    end
    local _, failure = host:fetch({ method = "PATCH", path = `/api/session/{id}`, body = { title = title } })
    state.busy = false
    if failure then
        return host:toast({ variant = "error", message = failure })
    end
    for _, session in state.sessions do
        if session.id == id then
            session.title = title
        end
    end
    host:toast({ variant = "success", message = t().renamed(title) })
end

-- TS `containsSession`: whether `target` is one of `roots` or under one.
local function contains(roots: { string }, target: string): boolean
    local byID: { [string]: grouping.Session } = {}
    for _, session in state.sessions do
        byID[session.id] = session
    end
    local cursor = byID[target]
    while cursor do
        if table.find(roots, cursor.id) then
            return true
        end
        cursor = cursor.parentID and byID[cursor.parentID]
    end
    return false
end

-- TS `isNotFound`.
local function notFound(error: string): boolean
    local lower = error:lower()
    return lower:find("notfound", 1, true) ~= nil or lower:find("not found", 1, true) ~= nil or lower:find("404", 1, true) ~= nil
end

-- TS `forgetDeleted`: the deleted sessions and their descendants go, and their tabs close.
local function forget(host: plugin.Host, ids: { string })
    local removed: { [string]: boolean } = {}
    local todo = table.clone(ids)
    while #todo > 0 do
        local id = table.remove(todo) :: string
        if not removed[id] then
            removed[id] = true
            for _, session in state.sessions do
                if session.parentID == id then
                    table.insert(todo, session.id)
                end
            end
        end
    end
    if state.from and removed[state.from] then
        state.from = nil
    end
    if host:tabsEnabled() then
        for id in removed do
            host:editTab({ type = "close", session = id })
        end
    end
    local kept: { grouping.Session } = {}
    for _, session in state.sessions do
        if not removed[session.id] then
            table.insert(kept, session)
        end
    end
    state.sessions = kept
end

-- Asks with `title`, `lines` and `yes`, then deletes `ids` one after another, `total` sessions with their
-- descendants: the deleted ones go, and a toast says so. A session that fails ends a single delete; a group's goes on
-- and is counted. The page takes no keys meanwhile.
local function remove(host: plugin.Host, title: string, lines: { string }, yes: string, ids: { string }, total: number, group: string?)
    state.busy = true
    if not confirm(host, title, lines, yes, t().cancel) then
        state.busy = false
        return
    end
    local done, failed = {}, 0
    for _, id in ids do
        local _, failure = host:fetch({ method = "DELETE", path = `/api/session/{id}` })
        if not failure or notFound(failure) then
            table.insert(done, id)
        elseif not group then
            state.busy = false
            return host:toast({ variant = "error", message = failure })
        else
            failed += 1
        end
    end
    forget(host, done)
    state.busy = false
    if not group then
        host:toast({ variant = "success", message = t().removed(total) })
    elseif failed > 0 then
        host:toast({ variant = "error", message = t().groupFailed(failed) })
    else
        host:toast({ variant = "success", message = t().groupRemoved(group, total) })
    end
    if group then
        refresh(host)
    end
end

-- TS `removeOne`: asks, then deletes the selected session.
local function removeOne(host: plugin.Host, rows: { Row })
    local index = indexOf(rows)
    local row = index and rows[index]
    if not row or row.type ~= "session" then
        return
    end
    local session = row.session
    local total = grouping.withDescendants({ session.id }, state.sessions)
    local lines = { t().removeMessage(grouping.title(session)) }
    if total > 1 then
        table.insert(lines, t().removeChildren(total - 1))
    end
    if session.id == state.from then
        table.insert(lines, t().removeCurrent)
    end
    table.insert(lines, t().irreversible)
    remove(host, t().removeTitle, lines, t().confirm, { session.id }, total)
end

-- TS `removeGroup`: asks, then deletes the selected group's top-level sessions, one after another.
local function removeGroup(host: plugin.Host, rows: { Row })
    local index = indexOf(rows)
    local row = index and rows[index]
    if not row then
        return
    end
    local group = row.group
    local ids: { string } = {}
    for _, root in group.roots do
        table.insert(ids, root.session.id)
    end
    if #ids == 0 then
        return
    end
    local total = grouping.withDescendants(ids, state.sessions)
    local lines = { t().groupMessage(t().modes[modeIndex(state.mode)], group.label, total) }
    if state.from and contains(ids, state.from) then
        table.insert(lines, t().groupCurrent)
    end
    if state.query:match("%S") then
        table.insert(lines, t().groupFiltered)
    end
    table.insert(lines, t().irreversible)
    remove(host, t().groupTitle(group.label), lines, t().groupConfirm(total), ids, total, group.label)
end

local function listKey(host: plugin.Host, name: string): plugin.Handled
    local groups, rows = listed()
    local index = indexOf(rows) or 0
    local pageSize = math.max(1, host:info().size[2] - 8)
    if name == "up" then
        select(host, rows, index - 1)
    elseif name == "down" then
        select(host, rows, index + 1)
    elseif name == "page-up" then
        select(host, rows, index - pageSize)
    elseif name == "page-down" then
        select(host, rows, index + pageSize)
    elseif name == "first" then
        select(host, rows, 1)
    elseif name == "last" then
        select(host, rows, #rows)
    elseif name == "open" then
        activate(host, rows)
    elseif name == "fold" then
        if rows[index] then
            fold(rows[index].group.key)
        end
    elseif name == "next-mode" then
        stepMode(host, 1)
    elseif name == "previous-mode" then
        stepMode(host, -1)
    elseif name == "children" then
        toggleChildren(host)
    elseif name == "rename" then
        rename(host, rows)
    elseif name == "delete" then
        removeOne(host, rows)
    elseif name == "delete-group" then
        removeGroup(host, rows)
    elseif name == "refresh" then
        refresh(host)
    elseif name == "search" then
        startSearch(host)
    elseif name == "language" then
        setLocale(host, if state.locale == "en" then "zh-CN" else "en")
    elseif name == "back" then
        if state.query:match("%S") then
            clearSearch(host)
        else
            back(host)
        end
    else
        return "pass"
    end
    local _ = groups
    return "consume"
end

local function searchKey(host: plugin.Host, name: string): plugin.Handled
    local _, rows = listed()
    local index = indexOf(rows) or 0
    local pageSize = math.max(1, host:info().size[2] - 8)
    if name == "up" then
        select(host, rows, index - 1)
    elseif name == "down" then
        select(host, rows, index + 1)
    elseif name == "page-up" then
        select(host, rows, index - pageSize)
    elseif name == "page-down" then
        select(host, rows, index + pageSize)
    elseif name == "finish" then
        finishSearch(host)
    elseif name == "clear" then
        clearSearch(host)
    else
        return "pass"
    end
    return "consume"
end

local function event(host: plugin.Host, event: plugin.InputEvent): plugin.Handled
    if event.type == "mount" then
        if event.mounted then
            mount(host)
        end
    elseif event.type == "change" and event.node == SEARCH then
        state.query = event.text
        state.searching = true
    elseif event.type == "key" and event.bind and not state.busy then
        local list, search = event.bind:match("^list:(.+)$"), event.bind:match("^search:(.+)$")
        -- A layer holds while nothing else is asked; the other's key goes on.
        if list and not state.searching then
            return listKey(host, list)
        elseif search and state.searching then
            return searchKey(host, search)
        end
    end
    return "pass"
end

local function nowrap(content: string | { plugin.Span }, props: { [string]: any }?)
    props = props or {}
    props.wrap = "none"
    props.layout = props.layout or { shrink = false }
    return plugin.text(content, props)
end

-- The page's header: its title, the modes, the totals and the languages.
local function header(count: number)
    local modes = {}
    for index, mode in grouping.MODES do
        local current = mode == state.mode
        table.insert(modes, nowrap(if current then `[{t().modes[index]}]` else ` {t().modes[index]} `, {
            fg = if current then "text.action.primary.base" else "text.muted",
            on_click = plugin.click("session-manager.mode", mode),
        }))
    end
    local locales = {}
    for position, code in i18n.codes do
        local spans = {}
        if position > 1 then
            table.insert(spans, plugin.span(" | ", { fg = "text.faint" }))
        end
        table.insert(spans, plugin.span(i18n.labels[code], if code == state.locale then { bold = true } else nil))
        table.insert(locales, nowrap(spans, {
            fg = if code == state.locale then "text.action.primary.base" else "text.muted",
            on_click = plugin.click("session-manager.locale", code),
        }))
    end
    return plugin.row({
        nowrap({ plugin.span(t().title, { bold = true }) }, { fg = "text.base" }),
        plugin.row(modes, { gap = 1, layout = { shrink = true, min_width_zero = true } }),
        plugin.column({}, { layout = { grow = true } }),
        nowrap(`{t().children(state.children)} · {t().total(count)}`, {
            fg = "text.muted",
            on_click = plugin.click("session-manager.children"),
        }),
        plugin.row(locales, { layout = { shrink = false } }),
    }, { gap = 2, layout = { shrink = false } })
end

local function searchRow(count: number, filtered: boolean)
    local row: { plugin.Node } = {
        nowrap("/", { fg = if state.searching then "text.action.primary.base" else "text.muted" }),
        { type = "input", id = SEARCH, value = state.query, placeholder = t().placeholder, layout = { grow = true } },
    }
    if filtered then
        table.insert(row, nowrap(t().matches(count), { fg = "text.muted" }))
    end
    return plugin.row(row, { gap = 1, layout = { shrink = false } })
end

local function row(index: number, row: Row, selected: boolean)
    local click = plugin.click("session-manager.row", tostring(index))
    local bg = if selected then "background.raised.high" else nil
    if row.type == "group" then
        local line = plugin.row({
            nowrap(if row.collapsed then "▶" else "▼", { fg = "text.action.primary.base" }),
            plugin.text({
                plugin.span(row.group.label, { bold = true }),
                plugin.span(` ({row.group.count})`, { fg = "text.muted" }),
            }, {
                fg = "text.base",
                wrap = "none",
                truncate = true,
                layout = { grow = true, shrink = true, min_width_zero = true },
            }),
        }, { gap = 1, bg = bg, on_click = click })
        return plugin.column({ line }, { id = rowId(index), padding_sides = { top = if index == 1 then 0 else 1 } })
    end
    local session = row.session
    local marker, color = "· ", "text.faint"
    if session.id == state.from then
        marker, color = "● ", "text.feedback.success.base"
    end
    local line = {
        plugin.text({
            plugin.span(row.prefix, { fg = "text.faint" }),
            plugin.span(marker, { fg = color }),
            plugin.span(grouping.title(session)),
        }, {
            fg = if row.depth > 0 then "text.muted" else "text.base",
            wrap = "none",
            truncate = true,
            layout = { grow = true, shrink = true, min_width_zero = true },
        }),
    }
    if state.mode ~= "directory" and row.depth == 0 then
        -- TS's `maxWidth={40}`, which the layout cannot say.
        table.insert(line, plugin.text(session.location.directory, { fg = "text.faint", wrap = "none", truncate = true }))
    end
    local sortMode = if state.mode == "directory" or state.mode == "project" then "updated" else state.mode
    table.insert(line, nowrap(grouping.age(grouping.time(session, sortMode), state.now, t()), { fg = "text.muted" }))
    return plugin.row(line, { id = rowId(index), gap = 1, padding_sides = { left = 2 }, bg = bg, on_click = click })
end

local function body(groups: { grouping.Group }, rows: { Row }, filtered: boolean): plugin.Node
    if state.loading then
        return plugin.text(t().loading, { fg = "text.muted" })
    elseif state.error then
        return plugin.text(t().loadFailed(state.error), { fg = "text.feedback.error.base" })
    elseif #rows == 0 then
        return plugin.text(if filtered then t().noMatch(state.query:match("^%s*(.-)%s*$") :: string) else t().empty, {
            fg = "text.muted",
        })
    end
    local selected = indexOf(rows)
    local nodes = {}
    for index, entry in rows do
        table.insert(nodes, row(index, entry, index == selected))
    end
    local _ = groups
    return { type = "scroll", id = ROWS, layout = { grow = true }, children = nodes }
end

-- The page, as TS's JSX draws it.
local function view()
    local groups, rows = listed()
    local count = 0
    for _, group in groups do
        count += group.count
    end
    local filtered = state.query:match("%S") ~= nil
    local nodes = { header(count) }
    if state.searching or filtered then
        table.insert(nodes, searchRow(count, filtered))
    end
    table.insert(nodes, body(groups, rows, filtered))
    local hints = {}
    for index, key in HINT_KEYS do
        table.insert(hints, nowrap({ plugin.span(key, { fg = "text.base" }), plugin.span(` {t().hints[index]}`, { fg = "text.muted" }) }))
    end
    table.insert(nodes, plugin.row(hints, { gap = 2, wrap = true, layout = { shrink = false } }))
    return plugin.column(nodes, {
        gap = 1,
        padding_sides = { top = 1, right = 2, bottom = 1, left = 2 },
        layout = { grow = true },
    })
end

local function binds(keys: { { string } }, prefix: string): plugin.Layer
    local list: { plugin.Bind } = {}
    for _, key in keys do
        table.insert(list, { key = key[1], name = prefix .. key[2] })
    end
    return { scope = "surface", priority = 100, keys = list }
end

return plugin.define(function(setup)
    setup:storageKey(SETTINGS)
    setup:command({
        name = "session-manager.open",
        title = "Session Manager",
        description = "Browse, rename and delete sessions grouped by directory, project or time",
        group = "Session",
        palette = true,
        slash = "session-manager",
    }, function(host)
        local route = host:route()
        if route.type == "plugin" and route.name == ROUTE then
            return
        end
        state.origin = if route.type == "session" then route.id else nil
        host:openRoute(ROUTE)
    end)
    setup:command({ name = "session-manager.row" }, function(host, input)
        local _, rows = listed()
        local index = (tonumber(input) or 0) + 1
        if indexOf(rows) == index then
            activate(host, rows)
        else
            select(host, rows, index)
        end
    end)
    setup:command({ name = "session-manager.mode" }, function(host, mode)
        if mode and table.find(grouping.MODES, mode) then
            setMode(host, mode)
        end
    end)
    setup:command({ name = "session-manager.locale" }, function(host, code)
        if code and i18n.messages[code] then
            setLocale(host, code)
        end
    end)
    setup:command({ name = "session-manager.children" }, toggleChildren)
    setup:surface({
        name = ROUTE,
        place = { type = "route", name = ROUTE },
        mounts = true,
        layers = { binds(LIST_KEYS, "list:"), binds(SEARCH_KEYS, "search:") },
    }, view, event)
    setup:onEvent({ "session.created", "session.deleted", "session.renamed", "session.archived" }, function(host)
        refresh(host)
    end)
end)
