--!strict
-- A port of `opencode-sidebar-prompt` 0.1.6 (`dist/tui.js`): the session's last prompt in the sidebar, delivered or
-- still queued in its inbox, and `/lastprompt` (or a click on "Open full prompt"), which shows the whole prompt in a
-- large centered dialog of its own: a header, the text, and a hint.
--
-- Options: `previewLength`, the sidebar preview's length in characters (40 to 600, 180 by default). TS counts
-- graphemes (`Intl.Segmenter`); the port counts UTF-8 characters, so a cluster of several counts as more than one.
local plugin = require("@opencode/plugin")

local OPEN = "sidebar.prompt.open"
-- What the sidebar's link runs, with its session.
local SHOW = "sidebar.prompt.show"
local DIALOG = "sidebar.prompt"
local CLOSE = "sidebar.prompt.close"

type Prompt = { text: string, created: number, pending: boolean }

-- TS `lastPrompt`: the newest of the session's user messages and of its inbox's user prompts not delivered yet; on a
-- tie, the later one listed.
local function lastPrompt(read: plugin.Read, session: string): Prompt?
    local latest: Prompt? = nil
    local delivered = {}
    local function consider(prompt: Prompt)
        if not latest or prompt.created >= latest.created then
            latest = prompt
        end
    end
    for _, message in read:messages(session) do
        if message.type == "user" then
            delivered[message.id] = true
            consider({ text = message.text, created = message.time.created, pending = false })
        end
    end
    for _, item in read:pending(session) do
        if item.type == "user" and not delivered[item.id] then
            consider({ text = item.payload.text, created = item.time.created, pending = true })
        end
    end
    return latest
end

-- TS `displayText`: line ends as `\n`, without terminal escapes (OSC and CSI) or other control characters.
local function displayText(text: string): string
    text = text:gsub("\r\n?", "\n")
    text = text:gsub("\27%][^\7\27]*\7", ""):gsub("\27%][^\7\27]*\27\\", "")
    text = text:gsub("\27%[[0-?]*[ -/]*[@-~]", "")
    -- C0 controls but tab and newline, DEL, and the C1 controls, which UTF-8 writes as `\194\128` to `\194\159`.
    text = text:gsub("[%z\1-\8\11-\31\127]", ""):gsub("\194[\128-\159]", "")
    return text
end

-- TS `promptPreview`: the text on one line, cut to `limit` characters with `…`.
local function preview(text: string, limit: number): string
    local compact = displayText(text):gsub("%s+", " "):match("^%s*(.-)%s*$") or ""
    if (utf8.len(compact) or #compact) <= limit then
        return compact
    end
    return compact:sub(1, (utf8.offset(compact, limit) or (#compact + 1)) - 1) .. "…"
end

-- TS `openPrompt`: the whole prompt in a large centered dialog, as the plugin draws it (`FullPromptDialog`).
local function show(host: plugin.Host, prompt: Prompt)
    local text = displayText(prompt.text)
    if text == "" then
        text = "[No prompt text: attachments only]"
    end
    local height = math.clamp(host:info().size[2] - 4, 6, 30)
    local header = plugin.row({
        plugin.text({ plugin.span("Last prompt", { bold = true }) }, { fg = "text.base" }),
        plugin.text("Esc · Close", { fg = "text.muted", on_click = plugin.click(CLOSE) }),
    }, { justify = "space-between", gap = 1, layout = { shrink = false } })
    -- TS's `<scrollbox>`: a panel's body has no scroll of its own, so long text is cut at the dialog's height.
    local scroll = plugin.column(
        { plugin.text(text, { fg = "text.base" }) },
        { layout = { grow = true, shrink = true, min_height = { cells = 1 } } }
    )
    local hint = plugin.text("↑ ↓ / PgUp PgDown · Scroll", { fg = "text.muted", layout = { shrink = false } })
    local body = plugin.column(
        { header, scroll, hint },
        { gap = 1, padding = { 1, 1 }, layout = { height = { cells = height } } }
    )
    host:dialog({
        type = "panel",
        key = DIALOG,
        size = "large",
        title = {},
        body = body,
        centered = true,
        bare = true,
    })
end

return plugin.define(function(setup)
    local options = setup.options
    local length = type(options) == "table" and options.previewLength
    local limit = if type(length) == "number" and length == length and math.abs(length) ~= math.huge
        then math.clamp(if length < 0 then math.ceil(length) else math.floor(length), 40, 600)
        else 180
    setup:command({
        name = OPEN,
        title = "Show full last prompt",
        group = "Sidebar",
        palette = true,
        slash = "lastprompt",
    }, function(host)
        -- TS's command is enabled on a session's route only.
        local route = host:route()
        if route.type ~= "session" then
            return
        end
        local prompt = lastPrompt(host, route.id)
        if prompt then
            show(host, prompt)
        else
            host:toast({ variant = "info", message = "No prompt submitted in this session." })
        end
    end)
    setup:command({ name = SHOW }, function(host, session)
        local prompt = session and lastPrompt(host, session)
        if prompt then
            show(host, prompt)
        end
    end)
    setup:command({ name = CLOSE }, function(host)
        host:dialog({ type = "close", key = DIALOG })
    end)
    setup:slot({ path = "sidebar.content" }, function(read, input, changed)
        local id = input.session_id
        if not id then
            return plugin.HIDE
        end
        local touched = changed.all
            or table.find(changed.lists or {}, id)
            or table.find(changed.sessions or {}, id)
        if not touched then
            return plugin.KEEP
        end
        local rows = { plugin.text({ plugin.span("Last prompt", { bold = true }) }, { fg = "text.base" }) }
        local prompt = lastPrompt(read, id)
        if prompt then
            if prompt.pending then
                table.insert(rows, plugin.text("Queued", { fg = "text.muted" }))
            end
            local shown = preview(prompt.text, limit)
            table.insert(rows, plugin.text(if shown == "" then "[Attachments only]" else shown, { fg = "text.base" }))
            table.insert(
                rows,
                plugin.text("Open full prompt · /lastprompt", {
                    fg = "text.action.primary.base",
                    on_click = plugin.click(SHOW, id),
                })
            )
        else
            table.insert(rows, plugin.text("No prompt submitted", { fg = "text.muted" }))
        end
        return plugin.show(plugin.column(rows, { layout = { margin = { top = 1 }, shrink = false } }))
    end)
end)
