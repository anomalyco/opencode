--!strict
-- A port of `opencode-command-hotkeys` 0.1.1 (`dist/tui.js`): keys and palette entries, from the plugin's options,
-- that run a server command in the session in view, or pause and resume its goal.
--
-- Options are `{ bindings = { { id, key, title, command, text? }, { id, key, title, action = "goal-toggle" } } }`,
-- checked whole before anything registers: an unknown field, a repeated `id` or key, or a bad value toasts and
-- registers nothing, and no value is echoed. A key holds in the base mode on a session's route; off one it goes on to
-- the host, as TS's disabled command lets it. One request per session and binding runs at a time.
local plugin = require("@opencode/plugin")

local TITLE = "Command Hotkeys"
local INVALID = "Проверьте bindings: строки id, key, title; для action command нужны command и необязательный "
    .. "text, для goal-toggle они запрещены. Неизвестные поля и повторяющиеся id/key запрещены."
local FAILED = "Не удалось выполнить команду. Проверьте её имя и аргументы в настройках плагина, доступность "
    .. "сессии и повторите попытку."

type Binding = { id: string, key: string, title: string, goal: boolean, command: string?, text: string }

local function trimmed(value: any): string?
    if type(value) ~= "string" then
        return nil
    end
    local text = value:match("^%s*(.-)%s*$") :: string
    return if text ~= "" then text else nil
end

local ALIASES = { enter = "return", esc = "escape", pgdown = "pagedown", pgup = "pageup", control = "ctrl" }
ALIASES.option = "meta"
ALIASES.alt = "meta"

-- TS `keyIdentity`: a key with its aliases named one way and the modifiers before its last part sorted, so
-- `Shift+Control+X` and `ctrl+shift+x` are one key.
local function identity(key: string): string
    local steps = {}
    for step in key:lower():gsub("%s*%+%s*", "+"):gmatch("%S+") do
        local parts = {}
        for part in step:gmatch("[^+]+") do
            table.insert(parts, ALIASES[part] or part)
        end
        local last = table.remove(parts)
        table.sort(parts)
        table.insert(parts, last)
        table.insert(steps, table.concat(parts, "+"))
    end
    return table.concat(steps, " ")
end

local FIELDS = { id = true, key = true, title = true, action = true, command = true, text = true }

-- TS `parseBindings`: the whole configuration, or `nil` for any fault in it.
local function parse(options: any): { Binding }?
    if type(options) ~= "table" then
        return nil
    end
    for name in options do
        if name ~= "bindings" then
            return nil
        end
    end
    local list = options.bindings
    if list == nil then
        return {}
    end
    -- An empty table reads as an empty list here: Luau cannot tell `{}` from `[]`.
    if type(list) ~= "table" or (next(list) ~= nil and #list == 0) then
        return nil
    end
    local bindings, ids, keys = {}, {}, {}
    for _, value in list do
        if type(value) ~= "table" then
            return nil
        end
        for name in value do
            if not FIELDS[name] then
                return nil
            end
        end
        local id, key, title = trimmed(value.id), trimmed(value.key), trimmed(value.title)
        if not id or not key or not title then
            return nil
        end
        local binding: Binding = { id = id, key = key, title = title, goal = false, text = "" }
        if value.action == "goal-toggle" then
            if value.command ~= nil or value.text ~= nil then
                return nil
            end
            binding.goal = true
        elseif value.action == nil or value.action == "command" then
            local command = trimmed(value.command)
            if not command or command:sub(1, 1) == "/" or command:find("%s") then
                return nil
            end
            if value.text ~= nil and type(value.text) ~= "string" then
                return nil
            end
            binding.command, binding.text = command, value.text or ""
        else
            return nil
        end
        if ids[id] then
            return nil
        end
        ids[id] = true
        for alternative in (key .. ","):gmatch("([^,]*),") do
            local name = identity(alternative)
            if name == "" or keys[name] then
                return nil
            end
            keys[name] = true
        end
        table.insert(bindings, binding)
    end
    return bindings
end

-- TS `ctx.client.session.command`.
local function command(session: string, name: string, text: string)
    return { method = "POST", path = `/api/session/{session}/command`, body = { name = name, text = text } }
end

return plugin.define(function(setup)
    local bindings = parse(if setup.options == nil then {} else setup.options)
    if not bindings then
        setup.host:toast({ variant = "error", title = TITLE, message = INVALID })
        return
    end
    if #bindings == 0 then
        return
    end
    -- The runs in flight: a lock per session and binding, and the step each request's reply moves on to.
    local locks: { [string]: boolean } = {}
    local waiting: { [number]: { step: string, session: string, binding: string, race: string? } } = {}

    local function finish(host, session: string, binding: string, failed: boolean)
        locks[`{session}\0{binding}`] = nil
        if failed then
            host:toast({ variant = "error", title = TITLE, message = FAILED, session = session })
        end
    end

    local function send(host, fetch, step: string, session: string, binding: string, race: string?)
        local id = host:fetch(fetch)
        if id then
            waiting[id] = { step = step, session = session, binding = binding, race = race }
        else
            finish(host, session, binding, true)
        end
    end

    -- TS `execute`: one run per session and binding at a time.
    local function execute(host, binding: Binding)
        local route = host:route()
        if route.type ~= "session" then
            return
        end
        local lock = `{route.id}\0{binding.id}`
        if locks[lock] then
            return
        end
        locks[lock] = true
        if binding.goal then
            send(host, { method = "GET", path = `/api/session/{route.id}` }, "session", route.id, binding.id)
        else
            send(host, command(route.id, binding.command :: string, binding.text), "command", route.id, binding.id)
        end
    end

    for _, binding in bindings do
        setup:command({ name = `command-hotkeys.{binding.id}`, title = binding.title, palette = true }, function(host)
            -- The palette closed before the command runs, so the keyboard is in its base mode again.
            if host:mode() == nil then
                execute(host, binding)
            end
        end)
    end
    -- The keys, each alternative of `a,b` a key of its own, named by its binding's place.
    local keys = {}
    for index, binding in bindings do
        for alternative in (binding.key .. ","):gmatch("([^,]*),") do
            table.insert(keys, { key = trimmed(alternative), name = tostring(index), title = binding.title })
        end
    end
    setup:layer({ scope = "global", keys = keys }, function(host, event)
        local binding = event.type == "key" and event.bind and bindings[tonumber(event.bind) :: number]
        if not binding or host:route().type ~= "session" then
            return "pass"
        end
        execute(host, binding)
        return "consume"
    end)
    setup:onReply(function(host, id, body, failure)
        local run = waiting[id]
        if not run then
            return
        end
        waiting[id] = nil
        local session, binding = run.session, run.binding
        if failure then
            local race = run.race and failure:find(run.race, 1, true)
            return finish(host, session, binding, not race)
        end
        if run.step == "command" or run.step == "toggle" then
            return finish(host, session, binding, false)
        end
        local route = host:route()
        if host:mode() ~= nil or route.type ~= "session" or route.id ~= session then
            return finish(host, session, binding, false)
        end
        if run.step == "session" then
            local location = body and body.data and body.data.location
            local directory = trimmed(location and location.directory)
            if not directory then
                return finish(host, session, binding, true)
            end
            local fetch = {
                method = "POST",
                path = "/api/rpc/opencode.goal/get",
                query = { { "location[directory]", directory } },
                body = { input = { sessionID = session } },
            }
            return send(host, fetch, "goal", session, binding)
        end
        local goal = body and body.output
        if goal == nil then
            return finish(host, session, binding, false)
        end
        if type(goal) ~= "table" or not trimmed(goal.id) then
            return finish(host, session, binding, true)
        end
        if goal.status == "complete" then
            return finish(host, session, binding, false)
        elseif goal.status == "active" then
            return send(host, command(session, "goal", "pause"), "toggle", session, binding, "No active goal to pause.")
        elseif goal.status == "paused" then
            return send(host, command(session, "goal", "resume"), "toggle", session, binding, "No paused goal to resume.")
        end
        return finish(host, session, binding, true)
    end)
end)
