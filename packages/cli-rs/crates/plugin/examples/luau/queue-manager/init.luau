--!strict
-- A port of `@bybrawe/opencode-queue-manager` 0.3.5 (`src/tui.ts`): `/qm` opens a menu that comes back after each
-- task. It stages drafts per session, edits, moves, sorts and clears them, publishes them to the session's queue one
-- by one, and lists and cancels the session's pending inbox items. The drafts are stored as TS stores them, under the
-- original's ID.
--
-- TS writes it as a chain of awaited dialogs; here each open dialog is an `ask`, and its answer or its close (escape)
-- goes on to the next one as TS's code would. Where it differs from TS: a Luau plugin reads no files, so importing a
-- `.txt` file says so in TS's error alert; sorting compares by byte after lowercasing, where TS collates in Turkish;
-- and the host's list of the session's pending items follows its own reads and events (no `pending.sync`).
local plugin = require("@opencode/plugin")
local core = require("@self/core")

-- What an open dialog asks and what a request waits for: a `kind` and the fields that kind carries.
type Asked = { [string]: any }
type Want = { [string]: any }

local DRAFTS = "queue-manager.drafts.v1"
local ANSWER = "queue.manager.answer"
local CLOSED = "queue.manager.closed"

local state = {
    -- The session the menu was opened in.
    session = "",
    -- The open dialog's generation and what it asks.
    generation = 0,
    asking = nil :: { generation: number, ask: Asked }?,
    -- Requests in flight, by ID: what each is for.
    waiting = {} :: { [number]: Want },
}

local function entries(host: plugin.Host): { string }
    local stored = host:storageGet(DRAFTS)
    local sessions = type(stored) == "table" and stored.sessions
    local list = type(sessions) == "table" and sessions[state.session]
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
    stored.sessions[state.session] = list
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

-- TS `getText`: the trimmed text, unless it is blank.
local function text(value: string): string?
    local trimmed = value:match("^%s*(.-)%s*$") :: string
    return if trimmed ~= "" then trimmed else nil
end

-- Opens `dialog` for `ask`, with a close that names its generation.
local function show(host: plugin.Host, dialog: plugin.Dialog, ask: Asked)
    state.generation += 1
    state.asking = { generation = state.generation, ask = ask }
    host:dialog({
        type = "dismissable",
        dialog = dialog,
        dismissed = plugin.command(CLOSED, tostring(state.generation)),
    })
end

local function option(title: string, value: string, description: string?): plugin.SelectOption
    return { title = title, value = value, description = description }
end

local function choose(host: plugin.Host, title: string, options: { plugin.SelectOption }, ask: Asked)
    show(host, { type = "select", title = title, options = options, action = plugin.command(ANSWER) }, ask)
end

local function prompt(host: plugin.Host, title: string, placeholder: string, ask: Asked)
    show(host, { type = "prompt", title = title, placeholder = placeholder, action = plugin.command(ANSWER) }, ask)
end

-- A confirm with its own labels; its answer is `true` or `false`.
local function confirm(host: plugin.Host, title: string, message: string, yes: string, no: string, ask: Asked)
    show(host, {
        type = "confirm",
        title = title,
        message = message,
        label = { confirm = yes, cancel = no },
        action = plugin.command(ANSWER),
    }, ask)
end

local function alert(host: plugin.Host, title: string, message: string, after: string)
    show(host, { type = "alert", title = title, message = message }, { kind = "alert", after = after })
end

-- TS `reportError`.
local function report(host: plugin.Host, message: string, after: string)
    alert(host, "Queue Manager - Error", message, after)
end

-- Sends `fetch` for `want`; one the host refuses fails as TS's request would, and goes on to `after`.
local function ask(host: plugin.Host, fetch: plugin.Fetch, want: Want, after: string)
    local id = host:fetch(fetch)
    if id then
        state.waiting[id] = want
    else
        report(host, "the host did not take the fetch", after)
    end
end

local function inboxList(host: plugin.Host, kind: string)
    -- A list that fails ends the manager, as TS's outer `try` does.
    ask(host, { method = "GET", path = `/api/session/{state.session}/inbox` }, { kind = kind }, "close")
end

-- One round of TS's menu loop: the pending count, then the menu.
local function menu(host: plugin.Host)
    inboxList(host, "menu")
end

-- One round of TS `nativeInbox`'s loop.
local function inbox(host: plugin.Host)
    inboxList(host, "inbox")
end

local function after(host: plugin.Host, where: string)
    if where == "menu" then
        menu(host)
    elseif where == "inbox" then
        inbox(host)
    end
end

local function showMenu(host: plugin.Host, pending: number)
    local drafts = #entries(host)
    choose(host, `Queue Manager | {drafts} drafts | {pending} native pending`, {
        option("Repeat 10 / 25 / 50 / 100 / 200 / custom", "repeat"),
        option("Add one draft message", "one"),
        option("Import lines from .txt", "import"),
        option(`Manage draft list ({drafts}) - edit, reorder, delete`, "drafts"),
        option("Reverse / sort draft list", "sort"),
        option(`Publish all drafts to OpenCode native queue ({drafts})`, "publish"),
        option(`View / cancel native pending messages ({pending})`, "native"),
        option("Clear draft list", "clear-drafts"),
        option("Clear native queued user prompts", "clear-native"),
        option("Close", "exit"),
    }, { kind = "menu", drafts = drafts })
end

-- TS `manageDrafts`' list.
local function drafts(host: plugin.Host)
    local list = entries(host)
    if #list == 0 then
        return alert(host, "Drafts", "Draft list is empty.", "menu")
    end
    local options: { plugin.SelectOption } = {}
    for index, entry in list do
        table.insert(options, option(`{string.format("%03d", index)}. {core.summarize(entry)}`, tostring(index - 1)))
    end
    table.insert(options, option("Back", "back"))
    choose(host, `Drafts ({#list}) - choose one`, options, { kind = "drafts" })
end

local function presets(host: plugin.Host, count: number)
    choose(host, "Choose message", {
        option("devam et", "devam et"),
        option("continue", "continue"),
        option("testleri çalıştır ve hataları düzelt", "testleri çalıştır ve hataları düzelt"),
        option("Custom message", "custom"),
    }, { kind = "preset", count = count })
end

-- TS `flushDrafts`: the first draft goes to the queue, and leaves the drafts once it is admitted.
local function publish(host: plugin.Host, sent: number, count: number)
    local first = entries(host)[1]
    if not first then
        toast(host, "Published", `{sent} messages admitted to the native queue.`)
        return menu(host)
    end
    ask(host, {
        method = "POST",
        path = `/api/session/{state.session}/prompt`,
        body = { text = first, delivery = "queue" },
    }, { kind = "publish", text = first, sent = sent, count = count }, "menu")
end

local function cancelEach(host: plugin.Host, left: { string }, done: number)
    local id = table.remove(left, 1)
    if not id then
        toast(host, "Cleared", `{done} pending prompts cancellation requested.`)
        return menu(host)
    end
    local fetch: plugin.Fetch = { method = "DELETE", path = `/api/session/{state.session}/inbox/{id}` }
    ask(host, fetch, { kind = "cancel-each", left = left, done = done }, "menu")
end

-- An action on draft `index` (from 0); the list comes back after it.
local function act(host: plugin.Host, index: number, action: string)
    local list = entries(host)
    local at, last = index + 1, math.max(#list, 1)
    local next, bad
    if action == "edit" then
        local title = `Replace draft #{at}`
        return prompt(host, title, core.summarize(list[at] or "", 65), { kind = "replace", index = at })
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
        return drafts(host)
    end
    if bad then
        return report(host, bad, "menu")
    end
    store(host, next :: { string })
    drafts(host)
end

-- An item of the menu.
local function chosen(host: plugin.Host, value: string, count: number)
    if value == "repeat" then
        local options: { plugin.SelectOption } = {}
        for _, n in { 10, 25, 50, 100, 200 } do
            table.insert(options, option(tostring(n), tostring(n)))
        end
        table.insert(options, option("Custom (1-500)", "custom"))
        choose(host, "Repeat count", options, { kind = "count" })
    elseif value == "one" then
        prompt(host, "Add one draft message", "Your prompt", { kind = "add" })
    elseif value == "import" then
        prompt(host, "Import UTF-8 .txt file (one message per line)", "C:\\path\\messages.txt", { kind = "import" })
    elseif value == "drafts" then
        drafts(host)
    elseif value == "sort" then
        choose(host, "Reorder draft list", {
            option("Reverse order", "reverse"),
            option("Sort A-Z", "asc"),
            option("Sort Z-A", "desc"),
        }, { kind = "sort" })
    elseif value == "publish" and count > 0 then
        local message = `Send {count} messages with delivery=queue to THIS session? They may begin executing immediately as the session becomes idle. This can incur provider costs.`
        confirm(host, "Publish to OpenCode native queue?", message, "Publish", "Cancel", { kind = "publish" })
    elseif value == "native" then
        inbox(host)
    elseif value == "clear-drafts" and count > 0 then
        local message = `Delete {count} draft entries? Native OpenCode pending prompts are NOT affected.`
        confirm(host, "Clear draft list?", message, "Clear drafts", "Cancel", { kind = "clear-drafts" })
    elseif value == "clear-native" then
        inboxList(host, "clear-native")
    elseif value ~= "exit" then
        menu(host)
    end
end

-- What a close without an answer goes on to, as TS's `undefined` does where it awaited.
local function escaped(host: plugin.Host, asked: Asked)
    local kind = asked.kind
    if kind == "menu" then
        return
    elseif kind == "actions" or kind == "replace" then
        drafts(host)
    elseif kind == "item" or kind == "cancel" then
        inbox(host)
    elseif kind == "alert" then
        after(host, asked.after)
    else
        menu(host)
    end
end

-- The answer to `asked`: what it chose or typed.
local function answer(host: plugin.Host, asked: Asked, value: string)
    local kind = asked.kind
    if kind == "menu" then
        chosen(host, value, asked.drafts)
    elseif kind == "add" then
        local entry = text(value)
        if entry then
            store(host, concat(entries(host), { entry }))
            toast(host, "Added", "Message appended to the draft list.")
        end
        menu(host)
    elseif kind == "import" then
        if text(value) then
            report(host, "A Luau plugin reads no files.", "menu")
        else
            menu(host)
        end
    elseif kind == "count" and value == "custom" then
        prompt(host, "How many?", "e.g. 150", { kind = "custom-count" })
    elseif kind == "count" or kind == "custom-count" then
        local raw = text(value)
        if not raw then
            return menu(host)
        end
        local count, bad = core.normalizeCount(raw)
        if not count then
            return report(host, bad :: string, "menu")
        end
        presets(host, count)
    elseif kind == "preset" and value == "custom" then
        prompt(host, "Message to repeat", "your prompt", { kind = "custom-message", count = asked.count })
    elseif kind == "preset" or kind == "custom-message" then
        local message = text(value)
        if not message then
            return menu(host)
        end
        local question = `Stage {asked.count} copies of '{core.summarize(message, 55)}'? No prompts will be sent yet.`
        local stage = { kind = "stage", count = asked.count, text = message }
        confirm(host, "Create repeated draft items?", question, "Stage", "Cancel", stage)
    elseif kind == "stage" then
        if value == "true" then
            local copies, bad = core.repeatMessage(asked.text, asked.count)
            if not copies then
                return report(host, bad :: string, "menu")
            end
            store(host, concat(entries(host), copies))
            toast(host, "Draft ready", `{asked.count} items added. Use 'Publish drafts' to send them to the native queue.`)
        end
        menu(host)
    elseif kind == "drafts" then
        local index = tonumber(value)
        if value == "back" then
            menu(host)
        elseif index then
            choose(host, `Draft #{index + 1}`, {
                option("Replace text", "edit"),
                option("Move up", "up"),
                option("Move down", "down"),
                option("Move to top", "top"),
                option("Move to bottom", "bottom"),
                option("Duplicate", "duplicate"),
                option("Delete", "delete"),
                option("Back", "back"),
            }, { kind = "actions", index = index })
        else
            drafts(host)
        end
    elseif kind == "actions" then
        act(host, asked.index, value)
    elseif kind == "replace" then
        local entry = text(value)
        if entry then
            local next, bad = core.editAt(entries(host), asked.index, entry)
            if not next then
                return report(host, bad :: string, "menu")
            end
            store(host, next)
        end
        drafts(host)
    elseif kind == "sort" then
        local list = entries(host)
        if value == "reverse" then
            local reversed = {}
            for index = #list, 1, -1 do
                table.insert(reversed, list[index])
            end
            list = reversed
        else
            table.sort(list, function(a: string, b: string): boolean
                return a:lower() < b:lower()
            end)
            if value == "desc" then
                local reversed = {}
                for index = #list, 1, -1 do
                    table.insert(reversed, list[index])
                end
                list = reversed
            end
        end
        store(host, list)
        toast(host, "Sorted", "Only the local draft order was changed.")
        menu(host)
    elseif kind == "clear-drafts" then
        if value == "true" then
            store(host, {})
        end
        menu(host)
    elseif kind == "publish" then
        if value == "true" then
            publish(host, 0, #entries(host))
        else
            menu(host)
        end
    elseif kind == "inbox" then
        local picked
        for _, item in asked.items do
            if item.id == value then
                picked = item
            end
        end
        if value == "back" then
            menu(host)
        elseif picked then
            choose(host, `Pending item ({picked.type})`, {
                option("Cancel this pending item", "cancel"),
                option("Back", "back"),
            }, { kind = "item", item = picked })
        else
            inbox(host)
        end
    elseif kind == "item" then
        if value == "cancel" then
            local message = "This cannot stop a message already being executed; only still-pending items can be cancelled."
            confirm(host, "Cancel pending item?", message, "Cancel item", "Keep", { kind = "cancel", id = asked.item.id })
        else
            inbox(host)
        end
    elseif kind == "cancel" then
        if value == "true" then
            local fetch: plugin.Fetch = { method = "DELETE", path = `/api/session/{state.session}/inbox/{asked.id}` }
            ask(host, fetch, { kind = "cancel" }, "inbox")
        else
            inbox(host)
        end
    elseif kind == "clear-native" then
        if value == "true" then
            cancelEach(host, asked.ids, 0)
        else
            menu(host)
        end
    elseif kind == "alert" then
        after(host, asked.after)
    end
end

-- A request of `want` that failed: what TS's `catch` there does.
local function failed(host: plugin.Host, want: Want, message: string)
    if want.kind == "publish" then
        local left = #entries(host)
        toast(host, "Partial publish", `{want.count - math.min(left, want.count)} admitted, {left} still in drafts.`)
        report(host, message, "menu")
    elseif want.kind == "cancel-each" then
        toast(host, "Partial clear", `{want.done} cancellations completed before the error.`)
        report(host, message, "menu")
    elseif want.kind == "cancel" then
        report(host, message, "inbox")
    else
        report(host, message, "close")
    end
end

local function replied(host: plugin.Host, want: Want, body: any)
    local items: { any } = if type(body) == "table" then (body.data or body) else {}
    if want.kind == "menu" then
        showMenu(host, #items)
    elseif want.kind == "inbox" then
        if #items == 0 then
            return alert(host, "Native inbox", "No pending items.", "menu")
        end
        local options: { plugin.SelectOption } = {}
        for index, item in items do
            local label = if item.type == "user" or item.type == "synthetic"
                then core.summarize(item.payload and item.payload.text or "")
                else `[{item.type}]`
            table.insert(options, option(`{string.format("%03d", index)}. {label}`, item.id, item.delivery))
        end
        table.insert(options, option("Back", "back"))
        choose(host, `OpenCode native inbox ({#items})`, options, { kind = "inbox", items = items })
    elseif want.kind == "clear-native" then
        local ids: { string } = {}
        for _, item in items do
            if item.type == "user" and item.delivery == "queue" then
                table.insert(ids, item.id)
            end
        end
        if #ids == 0 then
            return alert(host, "Native inbox", "No queued user prompts to cancel.", "menu")
        end
        local message = `Cancel {#ids} queued USER prompts? Synthetic, move and compaction entries will be kept. This does not stop active execution.`
        local title = "Cancel ALL native queued user prompts?"
        confirm(host, title, message, "Cancel queued prompts", "Keep all", { kind = "clear-native", ids = ids })
    elseif want.kind == "publish" then
        local list = entries(host)
        if list[1] ~= want.text then
            return failed(host, want, "Concurrent draft change detected; inspect drafts before retrying.")
        end
        table.remove(list, 1)
        store(host, list)
        publish(host, want.sent + 1, want.count)
    elseif want.kind == "cancel" then
        inbox(host)
    elseif want.kind == "cancel-each" then
        cancelEach(host, want.left, want.done + 1)
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
            return alert(host, "Queue Manager", message, "close")
        end
        state.session = route.id
        menu(host)
    end)
    setup:command({ name = ANSWER }, function(host, input)
        local asking = state.asking
        state.asking = nil
        if asking then
            answer(host, asking.ask, input or "")
        end
    end)
    -- Each dialog's close names its generation: it is an escape only while that dialog still waits for its answer.
    setup:command({ name = CLOSED }, function(host, input)
        local asking = state.asking
        if asking and tostring(asking.generation) == input then
            state.asking = nil
            escaped(host, asking.ask)
        end
    end)
    setup:onReply(function(host, id, body, failure)
        local want = state.waiting[id]
        if not want then
            return
        end
        state.waiting[id] = nil
        if failure then
            return failed(host, want, failure)
        end
        replied(host, want, body)
    end)
end)
