--!strict
-- A port of `@bybrawe/opencode-queue-manager` 0.3.5 (`src/tui.ts`): `/qm` opens a menu that comes back after each
-- task. It stages drafts per session, edits, moves, sorts and clears them, publishes them to the session's queue one
-- by one, and lists and cancels the session's pending inbox items. The drafts are stored as TS stores them, under the
-- original's ID.
--
-- TS writes it as a chain of awaited dialogs, and so does this port: each dialog and request waits in the command's
-- task. Where it differs from TS: a Luau plugin reads no files, so importing a `.txt` file says so in TS's error alert;
-- sorting compares by byte after lowercasing, where TS collates in Turkish; and the host's list of the session's
-- pending items follows its own reads and events (no `pending.sync`).
local plugin = require("@opencode/plugin")
local core = require("@self/core")

local DRAFTS = "queue-manager.drafts.v1"

-- The session the menu was opened in.
local session = ""

local function entries(host: plugin.Host): { string }
    local stored = host:storageGet(DRAFTS)
    local sessions = type(stored) == "table" and stored.sessions
    local list = type(sessions) == "table" and sessions[session]
    local out = {}
    if type(list) == "table" then
        for _, text in list do
            if type(text) == "string" then
                table.insert(out, text)
            end
        end
    end
    return out
end

-- TS `storeEntries`: the session's list in the stored drafts.
local function store(host: plugin.Host, list: { string })
    local stored = host:storageGet(DRAFTS)
    stored = if type(stored) == "table" then stored else {}
    if type(stored.sessions) ~= "table" then
        stored.sessions = {}
    end
    stored.sessions[session] = list
    host:storageSet(DRAFTS, stored)
end

local function concat(a: { string }, b: { string }): { string }
    local out = table.clone(a)
    table.move(b, 1, #b, #out + 1, out)
    return out
end

local function toast(host: plugin.Host, title: string, message: string)
    host:toast({ variant = "info", title = title, message = message })
end

-- TS `getText`: the trimmed text, unless it is blank or there is none.
local function text(value: string?): string?
    local trimmed = if value then value:match("^%s*(.-)%s*$") :: string else ""
    return if trimmed ~= "" then trimmed else nil
end

local function option(title: string, value: string, description: string?): plugin.SelectOption
    return { title = title, value = value, description = description }
end

-- A confirm with its own labels: whether it was confirmed.
local function confirm(host: plugin.Host, title: string, message: string, yes: string, no: string): boolean
    return host:confirm({ title = title, message = message, label = { confirm = yes, cancel = no } }) == true
end

-- TS `reportError`.
local function report(host: plugin.Host, message: string?)
    host:alert({ title = "Queue Manager - Error", message = message or "" })
end

-- The session's pending inbox items, or `nil` and why.
local function inbox(host: plugin.Host): ({ plugin.SessionInboxInfo }?, string?)
    local body, err = host:fetch({ method = "GET", path = `/api/session/{session}/inbox` })
    if err then
        return nil, err
    end
    return if type(body) == "table" then (body.data or body) else {}, nil
end

local function cancel(host: plugin.Host, id: string): string?
    local _, err = host:fetch({ method = "DELETE", path = `/api/session/{session}/inbox/{id}` })
    return err
end

-- TS's repeat: a count, a message, and a confirm that stages that many copies.
local function repeatDrafts(host: plugin.Host)
    local counts: { plugin.SelectOption } = {}
    for _, n in { 10, 25, 50, 100, 200 } do
        table.insert(counts, option(tostring(n), tostring(n)))
    end
    table.insert(counts, option("Custom (1-500)", "custom"))
    local picked = host:select({ title = "Repeat count", options = counts })
    if picked == "custom" then
        picked = host:prompt({ title = "How many?", placeholder = "e.g. 150" })
    end
    local raw = text(picked)
    if not raw then
        return
    end
    local count, bad = core.normalizeCount(raw)
    if not count then
        return report(host, bad)
    end
    local chosen = host:select({
        title = "Choose message",
        options = {
            option("devam et", "devam et"),
            option("continue", "continue"),
            option("testleri çalıştır ve hataları düzelt", "testleri çalıştır ve hataları düzelt"),
            option("Custom message", "custom"),
        },
    })
    if chosen == "custom" then
        chosen = host:prompt({ title = "Message to repeat", placeholder = "your prompt" })
    end
    local message = text(chosen)
    if not message then
        return
    end
    local question = `Stage {count} copies of '{core.summarize(message, 55)}'? No prompts will be sent yet.`
    if not confirm(host, "Create repeated draft items?", question, "Stage", "Cancel") then
        return
    end
    local copies, failed = core.repeatMessage(message, count)
    if not copies then
        return report(host, failed)
    end
    store(host, concat(entries(host), copies))
    toast(host, "Draft ready", `{count} items added. Use 'Publish drafts' to send them to the native queue.`)
end

-- An action on draft `index` (from 0): what went wrong, if anything.
local function act(host: plugin.Host, index: number): string?
    local action = host:select({
        title = `Draft #{index + 1}`,
        options = {
            option("Replace text", "edit"),
            option("Move up", "up"),
            option("Move down", "down"),
            option("Move to top", "top"),
            option("Move to bottom", "bottom"),
            option("Duplicate", "duplicate"),
            option("Delete", "delete"),
            option("Back", "back"),
        },
    })
    local list = entries(host)
    local at, last = index + 1, math.max(#list, 1)
    local next, bad
    if action == "edit" then
        local title = `Replace draft #{at}`
        local entry = text(host:prompt({ title = title, placeholder = core.summarize(list[at] or "", 65) }))
        if not entry then
            return nil
        end
        next, bad = core.editAt(entries(host), at, entry)
    elseif action == "delete" then
        next, bad = core.deleteAt(list, at)
    elseif action == "duplicate" and list[at] then
        next = table.clone(list)
        table.insert(next, at + 1, list[at])
    elseif action == "up" then
        next, bad = core.moveAt(list, at, math.max(1, at - 1))
    elseif action == "down" then
        next, bad = core.moveAt(list, at, math.min(last, at + 1))
    elseif action == "top" then
        next, bad = core.moveAt(list, at, 1)
    elseif action == "bottom" then
        next, bad = core.moveAt(list, at, last)
    else
        return nil
    end
    if bad then
        return bad
    end
    store(host, next :: { string })
    return nil
end

-- TS `manageDrafts`: the list, and an action on the draft picked, until Back.
local function manageDrafts(host: plugin.Host)
    while true do
        local list = entries(host)
        if #list == 0 then
            return host:alert({ title = "Drafts", message = "Draft list is empty." })
        end
        local options: { plugin.SelectOption } = {}
        for index, entry in list do
            table.insert(options, option(`{string.format("%03d", index)}. {core.summarize(entry)}`, tostring(index - 1)))
        end
        table.insert(options, option("Back", "back"))
        local picked = host:select({ title = `Drafts ({#list}) - choose one`, options = options })
        if picked == nil or picked == "back" then
            return
        end
        local index = tonumber(picked)
        local bad = index and act(host, index)
        if bad then
            return report(host, bad)
        end
    end
end

local function sortDrafts(host: plugin.Host)
    local order = host:select({
        title = "Reorder draft list",
        options = { option("Reverse order", "reverse"), option("Sort A-Z", "asc"), option("Sort Z-A", "desc") },
    })
    if not order then
        return
    end
    local list = entries(host)
    if order ~= "reverse" then
        table.sort(list, function(a: string, b: string): boolean
            return a:lower() < b:lower()
        end)
    end
    if order ~= "asc" then
        local reversed = {}
        for index = #list, 1, -1 do
            table.insert(reversed, list[index])
        end
        list = reversed
    end
    store(host, list)
    toast(host, "Sorted", "Only the local draft order was changed.")
end

-- TS `flushDrafts`: each draft goes to the queue in turn, and leaves the drafts once it is admitted.
local function publishDrafts(host: plugin.Host, drafts: number)
    local message = `Send {drafts} messages with delivery=queue to THIS session? They may begin executing immediately as the session becomes idle. This can incur provider costs.`
    if not confirm(host, "Publish to OpenCode native queue?", message, "Publish", "Cancel") then
        return
    end
    local count, sent = #entries(host), 0
    while true do
        local first = entries(host)[1]
        if not first then
            break
        end
        local path = `/api/session/{session}/prompt`
        local _, err = host:fetch({ method = "POST", path = path, body = { text = first, delivery = "queue" } })
        local list = entries(host)
        if not err and list[1] ~= first then
            err = "Concurrent draft change detected; inspect drafts before retrying."
        end
        if err then
            local left = #list
            toast(host, "Partial publish", `{count - math.min(left, count)} admitted, {left} still in drafts.`)
            return report(host, err)
        end
        table.remove(list, 1)
        store(host, list)
        sent += 1
    end
    toast(host, "Published", `{sent} messages admitted to the native queue.`)
end

-- TS `nativeInbox`: the pending items, and a cancel of the one picked, until Back. `false` once a list failed, which
-- ends the manager.
local function nativeInbox(host: plugin.Host): boolean
    while true do
        local items, err = inbox(host)
        if not items then
            report(host, err)
            return false
        end
        if #items == 0 then
            host:alert({ title = "Native inbox", message = "No pending items." })
            return true
        end
        local options: { plugin.SelectOption } = {}
        for index, item in items do
            local label = if item.type == "user" or item.type == "synthetic"
                then core.summarize(item.payload and item.payload.text or "")
                else `[{item.type}]`
            table.insert(options, option(`{string.format("%03d", index)}. {label}`, item.id, item.delivery))
        end
        table.insert(options, option("Back", "back"))
        local value = host:select({ title = `OpenCode native inbox ({#items})`, options = options })
        if value == nil or value == "back" then
            return true
        end
        local picked: any
        for _, item in items do
            if item.id == value then
                picked = item
            end
        end
        local action = picked
            and host:select({
                title = `Pending item ({picked.type})`,
                options = { option("Cancel this pending item", "cancel"), option("Back", "back") },
            })
        local message = "This cannot stop a message already being executed; only still-pending items can be cancelled."
        if action == "cancel" and confirm(host, "Cancel pending item?", message, "Cancel item", "Keep") then
            local failed = cancel(host, picked.id)
            if failed then
                report(host, failed)
            end
        end
    end
end

-- TS's clear of the native queue: every queued user prompt cancelled in turn. `false` once the list failed.
local function clearNative(host: plugin.Host): boolean
    local items, err = inbox(host)
    if not items then
        report(host, err)
        return false
    end
    local ids: { string } = {}
    for _, item in items do
        if item.type == "user" and item.delivery == "queue" then
            table.insert(ids, item.id)
        end
    end
    if #ids == 0 then
        host:alert({ title = "Native inbox", message = "No queued user prompts to cancel." })
        return true
    end
    local message = `Cancel {#ids} queued USER prompts? Synthetic, move and compaction entries will be kept. This does not stop active execution.`
    if not confirm(host, "Cancel ALL native queued user prompts?", message, "Cancel queued prompts", "Keep all") then
        return true
    end
    for done, id in ids do
        local failed = cancel(host, id)
        if failed then
            toast(host, "Partial clear", `{done - 1} cancellations completed before the error.`)
            report(host, failed)
            return true
        end
    end
    toast(host, "Cleared", `{#ids} pending prompts cancellation requested.`)
    return true
end

-- TS's menu loop: the pending count, then the menu, until Close or escape.
local function manager(host: plugin.Host)
    while true do
        local items, err = inbox(host)
        if not items then
            return report(host, err)
        end
        local drafts = #entries(host)
        local value = host:select({
            title = `Queue Manager | {drafts} drafts | {#items} native pending`,
            options = {
                option("Repeat 10 / 25 / 50 / 100 / 200 / custom", "repeat"),
                option("Add one draft message", "one"),
                option("Import lines from .txt", "import"),
                option(`Manage draft list ({drafts}) - edit, reorder, delete`, "drafts"),
                option("Reverse / sort draft list", "sort"),
                option(`Publish all drafts to OpenCode native queue ({drafts})`, "publish"),
                option(`View / cancel native pending messages ({#items})`, "native"),
                option("Clear draft list", "clear-drafts"),
                option("Clear native queued user prompts", "clear-native"),
                option("Close", "exit"),
            },
        })
        if value == nil or value == "exit" then
            return
        elseif value == "repeat" then
            repeatDrafts(host)
        elseif value == "one" then
            local entry = text(host:prompt({ title = "Add one draft message", placeholder = "Your prompt" }))
            if entry then
                store(host, concat(entries(host), { entry }))
                toast(host, "Added", "Message appended to the draft list.")
            end
        elseif value == "import" then
            local title = "Import UTF-8 .txt file (one message per line)"
            if text(host:prompt({ title = title, placeholder = "C:\\path\\messages.txt" })) then
                report(host, "A Luau plugin reads no files.")
            end
        elseif value == "drafts" then
            manageDrafts(host)
        elseif value == "sort" then
            sortDrafts(host)
        elseif value == "publish" and drafts > 0 then
            publishDrafts(host, drafts)
        elseif value == "native" then
            if not nativeInbox(host) then
                return
            end
        elseif value == "clear-drafts" and drafts > 0 then
            local message = `Delete {drafts} draft entries? Native OpenCode pending prompts are NOT affected.`
            if confirm(host, "Clear draft list?", message, "Clear drafts", "Cancel") then
                store(host, {})
            end
        elseif value == "clear-native" then
            if not clearNative(host) then
                return
            end
        end
    end
end

return plugin.define(function(setup)
    setup:storageKey(DRAFTS)
    setup:command({
        name = "queue.manager.open",
        title = "Queue Manager",
        group = "Queue Manager",
        palette = true,
        slash = "qm",
    }, function(host)
        local route = host:route()
        if route.type ~= "session" then
            local message = "Open a session in the OpenCode v2 terminal UI first, then run /qm."
            return host:alert({ title = "Queue Manager", message = message })
        end
        session = route.id
        manager(host)
    end)
end)
