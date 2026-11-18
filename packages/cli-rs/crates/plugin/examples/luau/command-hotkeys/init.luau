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
    local text = (value :: string):match("^%s*(.-)%s*$") :: string
    return if text ~= "" then text else nil
end

local ALIASES: { [string]: string } = { enter = "return", esc = "escape", pgdown = "pagedown", pgup = "pageup", control = "ctrl" }
ALIASES.option = "meta"
ALIASES.alt = "meta"

-- TS `keyIdentity`: a key with its aliases named one way and the modifiers before its last part sorted, so
-- `Shift+Control+X` and `ctrl+shift+x` are one key. A step splits at each `+` with its empty parts kept, as
-- JavaScript's `split` does: `+`, the plus key, is a key of its own.
local function identity(key: string): string
    local steps: { string } = {}
    for step in (key:lower():gsub("%s*%+%s*", "+")):gmatch("%S+") do
        local parts: { string } = {}
        for _, part in step:split("+") do
            table.insert(parts, ALIASES[part] or part)
        end
        local last = table.remove(parts) :: string
        table.sort(parts)
        table.insert(parts, last)
        table.insert(steps, table.concat(parts, "+"))
    end
    return table.concat(steps, " ")
end

local FIELDS = { id = true, key = true, title = true, action = true, command = true, text = true }

-- TS `parseBindings`: the whole configuration, or `nil` for any fault in it.
local function parse(options: any): { Binding }?
    if type(options) ~= "table" or plugin.json.isArray(options) then
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
    if type(list) ~= "table" or not plugin.json.isArray(list) then
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
local function command(session: string, name: string, text: string): plugin.Fetch
    return { method = "POST", path = `/api/session/{session}/command`, body = { name = name, text = text } }
end

return plugin.define(function(setup)
    local bindings = parse(if setup.options == nil then plugin.json.object({}) else setup.options)
    if not bindings then
        setup.host:toast({ variant = "error", title = TITLE, message = INVALID })
        return
    end
    if #bindings == 0 then
        return
    end
    -- The runs in flight: a lock per session and binding.
    local locks: { [string]: boolean } = {}

    -- One run of `binding` in `session`: whether it failed. It stops once the user left the session or opened a
    -- dialog, as TS's does.
    local function run(host: plugin.Host, session: string, binding: Binding): boolean
        if not binding.goal then
            local _, err = host:fetch(command(session, binding.command :: string, binding.text))
            return err ~= nil
        end
        local function away(): boolean
            local route = host:route()
            return host:mode() ~= nil or route.type ~= "session" or route.id ~= session
        end
        local body, err = host:fetch({ method = "GET", path = `/api/session/{session}` })
        if err then
            return true
        elseif away() then
            return false
        end
        local location = body and body.data and body.data.location
        local directory = trimmed(location and location.directory)
        if not directory then
            return true
        end
        local reply, failure = host:fetch({
            method = "POST",
            path = "/api/rpc/opencode.goal/get",
            query = { { "location[directory]", directory } },
            body = { input = { sessionID = session } },
        })
        if failure then
            return true
        elseif away() then
            return false
        end
        local goal = reply and reply.output
        if goal == nil then
            return false
        elseif type(goal) ~= "table" or not trimmed(goal.id) then
            return true
        elseif goal.status == "complete" then
            return false
        end
        -- A goal another client paused or resumed meanwhile is no failure.
        local verb, race = "pause", "No active goal to pause."
        if goal.status == "paused" then
            verb, race = "resume", "No paused goal to resume."
        elseif goal.status ~= "active" then
            return true
        end
        local _, toggled = host:fetch(command(session, "goal", verb))
        return toggled ~= nil and not toggled:find(race, 1, true)
    end

    -- TS `execute`: one run per session and binding at a time.
    local function execute(host: plugin.Host, binding: Binding)
        local route = host:route()
        if route.type ~= "session" then
            return
        end
        local session = route.id
        local lock = `{session}\0{binding.id}`
        if locks[lock] then
            return
        end
        locks[lock] = true
        local failed = run(host, session, binding)
        locks[lock] = nil
        if failed then
            host:toast({ variant = "error", title = TITLE, message = FAILED, session = session })
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
            -- `parse` refused a blank alternative, so each is a key.
            table.insert(keys, { key = trimmed(alternative) :: string, name = tostring(index), title = binding.title })
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
end)
