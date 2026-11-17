--!strict
-- `@opencode/plugin`: what every Luau plugin requires. `define` names the setup; the rest builds the contract's tables
-- (`schema/v2.json`), which a plugin may also write by hand. Types: `opencode/plugin.luau`.
--
-- Each helper builds its table in one record literal. A literal with only named fields is a copy of a template made
-- when the chunk loads (`DUPTABLE`), and a field written `= nil` still gets its slot in the template. So a helper given
-- `props` starts from a table that already has room for the common fields, and copying `props` into it does not grow
-- it. A helper given no `props` builds the smallest table and runs no loop.

-- What the host hands this chunk: `fail(message)` fails the running call with `message` though nothing more can be
-- allocated to raise it.
local fail: (string) -> never = ...

local plugin = {}

plugin.contract = "2.0"

-- The host's optional features, which `read:hasFeature` asks for: a field the plugin focuses (`host:focus` of an
-- `input` node), and the host's own code view of a claimed fence (a `fence` node).
plugin.IMAGE_BOUNDS = "image-bounds"
plugin.FOCUS_INPUT = "focus-input"
plugin.FENCE_NODE = "fence-node"

-- What a render returns besides `plugin.show(node)`: keep what shows, or show nothing (as `nil` does).
plugin.KEEP = table.freeze({ type = "keep" })
plugin.HIDE = table.freeze({ type = "hide" })

-- Tasks ---------------------------------------------------------------------------------------------------------------
--
-- Each handler the host calls with a `host` (a command's, `onEvent`'s, `onMount`'s, `onRouteMount`'s, a layer's and a
-- surface's) runs as a task: a coroutine this module drives. A waiting call (`host:fetch`, `host:foreground`,
-- `host:select`, `host:prompt`, `host:confirm`, `host:alert`, `plugin.all`) parks its task and returns once its answer
-- comes, in the host call that carries the answer: a reply's, or the dialog's answer or close. So what a task asks for
-- after a wait is the effects of that call, timed and limited as that call is: the CPU budget holds for each stretch
-- between two waits, and a parked task costs no time. A render, a view, a search, `onDispose` and setup are not tasks,
-- and a waiting call there fails; setup may start one with `plugin.spawn`.
--
-- A task parked when its plugin is disabled, fails or reloads is dropped with the VM and never goes on. A task parked on
-- a fetch whose mount closes is not told yet: the host cancels the request and the task stays parked for the rest of
-- the activation. Start a flow that waits from a command or an event, not from `onMount`, until then.

-- What a task's coroutine yields once its handler returned; a waiting call yields nothing.
local ENDED = table.freeze({})

-- The most tasks a plugin may have parked at once; a waiting call past it fails.
local PARKED = 256

-- The coroutines that are tasks: only they may wait.
local tasks: { [thread]: boolean } = setmetatable({}, { __mode = "k" }) :: any
local parked = 0
-- A handler's coroutine whose last handler returned without waiting, kept for the next one.
local idle: thread? = nil

-- A handler's coroutine: runs `f(a, b, c)`, yields `ENDED` and its first result, and runs the next handler it is
-- resumed with. Handlers take at most three arguments.
local function worker(f, a, b, c)
    while true do
        f, a, b, c = coroutine.yield(ENDED, (f(a, b, c)))
    end
end

-- Error `message` of task `co` with the task's frames, as the host writes a traceback (`<file>:<line>: in function
-- 'name'`), so its report keeps the plugin's own frames.
local function traceback(co: thread, message: any): string
    local lines = { tostring(message), "stack traceback:" }
    local level = 0
    while true do
        local source, line, name, f = debug.info(co, level, "slnf")
        if source == nil then
            break
        end
        local file = if source:sub(1, 1) == "@" or source:sub(1, 1) == "=" then source:sub(2) else source
        if name and name ~= "" then
            table.insert(lines, `\t{file}:{line}: in function '{name}'`)
        else
            table.insert(lines, `\t{file}:{line}: in function <{file}:{if f then debug.info(f, "l") else 0}>`)
        end
        level += 1
    end
    return table.concat(lines, "\n")
end

-- What resuming task `co` gave: whether its handler ended, and its first result. An error in the task is raised again,
-- with the task's traceback, so the host call fails and the plugin with it.
local function settle(co: thread, ok: boolean, mark: any, result: any): (boolean, any)
    if not ok then
        tasks[co] = nil
        local built, text = false, nil
        if mark ~= "not enough memory" then
            built, text = pcall(traceback, co, mark)
        end
        if not built then
            -- Out of memory, most likely with what the task holds: its stack goes first.
            coroutine.close(co)
            fail(tostring(mark))
        end
        error(text, 0)
    end
    if mark ~= ENDED then
        return false, nil
    end
    if idle == nil and coroutine.status(co) == "suspended" then
        idle = co
    end
    return true, result
end

-- Runs handler `f` as a task: whether it ended without waiting, and its first result.
local function run(f, a, b, c): (boolean, any)
    local co = idle
    idle = nil
    if co == nil then
        co = coroutine.create(worker)
        tasks[co] = true
    end
    return settle(co, coroutine.resume(co, f, a, b, c))
end

-- Goes on with parked task `co`, its waiting call returning `...`.
local function wake(co: thread, ...)
    parked -= 1
    settle(co, coroutine.resume(co, ...))
end

-- The running task, or an error naming waiting call `name` at the plugin's line `level` frames up.
local function task(name: string, level: number): thread
    local co = coroutine.running()
    if not tasks[co] then
        error(
            `{name} waits, and only a task can: a command's, an event's, a mount's, a layer's or a surface's handler, or plugin.spawn`,
            level
        )
    end
    if parked >= PARKED then
        error(`{name}: more than {PARKED} tasks of the plugin wait`, level)
    end
    return co
end

-- Parks the running task until `wake` goes on with it, and returns what `wake` was given.
local function park(): ...any
    parked += 1
    return coroutine.yield()
end

-- Starts `f(...)` as a task of its own, from a handler, from another task or from setup. It runs until it ends or
-- waits, then the caller goes on.
function plugin.spawn(f: (...any) -> ...any, ...)
    local co = coroutine.create(function(...)
        return ENDED, (f(...))
    end)
    tasks[co] = true
    settle(co, coroutine.resume(co, ...))
end

-- Runs each function of `fns` as a task and waits until all ended. Each returns `value` or `nil, err`: the result is
-- the values in order, or `nil` and the error of the first that failed.
function plugin.all(fns: { () -> (any, any) }): ({ any }?, any)
    local co = task("plugin.all", 3)
    local results, left, failure, waiting = {}, #fns, nil, false
    for index, f in fns do
        plugin.spawn(function()
            local value, err = f()
            if err ~= nil and failure == nil then
                failure = err
            end
            results[index] = value
            left -= 1
            if left == 0 and waiting then
                wake(co)
            end
        end)
    end
    if left > 0 then
        waiting = true
        park()
    end
    if failure ~= nil then
        return nil, failure
    end
    return results, nil
end

-- The setup object a plugin's setup gets: the host's, with each handler a task, the waiting calls on `host`, and the
-- two hidden commands the dialogs answer through. The reply handler is this module's.
local function tasked(raw)
    local host = raw.host
    local fetch, foreground, dialog = host.fetch, host.foreground, host.dialog
    local answer, closed = `{raw.id}.task.answer`, `{raw.id}.task.closed`
    -- Requests in flight, by ID, and the dialogs shown by tasks that have not closed, by number, with what they ask.
    local requests: { [number]: thread } = {}
    local dialogs: { [number]: { co: thread, kind: string } } = {}
    local shown, top = 0, 0

    local function request(name: string, send, self, spec): (any, string?)
        local co = task(name, 4)
        local id, why = send(self, spec)
        if id == nil then
            return nil, why
        end
        requests[id] = co
        return park()
    end
    host.fetch = function(self, spec)
        return request("host:fetch", fetch, self, spec)
    end
    host.foreground = function(self, spec)
        return request("host:foreground", foreground, self, spec)
    end
    raw.onReply(raw, function(_, id: number, value: any, err: string?)
        local co = requests[id]
        if co then
            requests[id] = nil
            if err ~= nil then
                wake(co, nil, err)
            else
                wake(co, value, nil)
            end
        end
    end)

    -- Shows `spec` as a dialog of `kind` and parks until it is answered (the answer) or closes without one (`nil`).
    local function ask(name: string, self, kind: string, spec): any
        local co = task(name, 4)
        local shape: { [string]: any } = table.clone(spec)
        shape.type = kind
        if kind ~= "alert" then
            shape.action = { type = "command", name = answer }
        end
        shown += 1
        top = shown
        dialogs[shown] = { co = co, kind = kind }
        dialog(self, {
            type = "dismissable",
            dialog = shape,
            dismissed = { type = "command", name = closed, input = tostring(shown) },
        })
        return park()
    end
    host.select = function(self, spec)
        return ask("host:select", self, "select", spec)
    end
    host.prompt = function(self, spec)
        return ask("host:prompt", self, "prompt", spec)
    end
    host.confirm = function(self, spec)
        return ask("host:confirm", self, "confirm", spec)
    end
    host.alert = function(self, spec)
        ask("host:alert", self, "alert", spec)
    end
    -- An answer is the dialog's on top: the host closes it and runs its action, then its close.
    raw.command(raw, { name = answer }, function(_, input: string?)
        local asked = dialogs[top]
        if asked then
            dialogs[top] = nil
            local value = input or ""
            wake(asked.co, if asked.kind == "confirm" then value == "true" else value)
        end
    end)
    -- A close of a dialog still unanswered: an escape, the backdrop, another dialog in its place, or an alert's `ok`.
    raw.command(raw, { name = closed }, function(_, input: string?)
        local number = tonumber(input)
        local asked = number and dialogs[number]
        if asked then
            dialogs[number :: number] = nil
            wake(asked.co, nil)
        end
    end)

    -- A handler that acts, as a task.
    local function acting(register: string, wrap)
        return function(_, spec, handler)
            return raw[register](raw, spec, if type(handler) == "function" then wrap(handler) else handler)
        end
    end
    local function plain(handler)
        return function(a, b, c)
            run(handler, a, b, c)
        end
    end
    -- A key or input handler that waits has taken its event.
    local function handled(handler)
        return function(a, b)
            local ended, result = run(handler, a, b)
            if ended then
                return result
            end
            return "consume"
        end
    end
    local passed = function(name: string)
        return function(_, ...)
            return raw[name](raw, ...)
        end
    end
    return table.freeze({
        id = raw.id,
        options = raw.options,
        host = host,
        storageKey = passed("storageKey"),
        slot = passed("slot"),
        route = passed("route"),
        codeBlock = passed("codeBlock"),
        onDispose = passed("onDispose"),
        command = acting("command", plain),
        onEvent = acting("onEvent", plain),
        onRouteMount = acting("onRouteMount", plain),
        -- The slot's input is a table the host fills again for its next call: a task that waits keeps a copy.
        onMount = acting("onMount", function(handler)
            return function(h, input, mounted)
                local copy = table.clone(input)
                if copy.prompt then
                    copy.prompt = table.clone(copy.prompt)
                end
                run(handler, h, copy, mounted)
            end
        end),
        layer = acting("layer", handled),
        -- A surface's handler is its third argument; its view is not a task.
        surface = function(_, spec, view, handler)
            return raw.surface(raw, spec, view, if handler then handled(handler) else nil)
        end,
    })
end

function plugin.define(setup)
    if type(setup) ~= "function" then
        error("plugin.define needs a setup function", 2)
    end
    return table.freeze({
        __opencode_setup = function(raw)
            setup(tasked(raw))
        end,
    })
end

-- A span: `plugin.span("text", { fg = "text.muted", bold = true })`.
function plugin.span(text: string, style: { [string]: any }?)
    if not style then
        return { text = text }
    end
    local span: { [string]: any } = { text = text, fg = nil, bg = nil, bold = nil }
    for key, value in style do
        span[key] = value
    end
    return span
end

-- A text node of a string or a list of spans; `props` adds fields (`fg`, `wrap`, `on_click`, `id`, `layout`, ...).
function plugin.text(content, props: { [string]: any }?)
    local spans = if type(content) == "string" then { { text = content } } else content
    if not props then
        return { type = "text", spans = spans }
    end
    local node: { [string]: any } =
        { type = "text", spans = spans, fg = nil, on_click = nil, id = nil, wrap = nil, layout = nil, truncate = nil }
    for key, value in props do
        node[key] = value
    end
    return node
end

-- A box of children in a column or a row.
function plugin.column(children, props: { [string]: any }?)
    if not props then
        return { type = "box", row = false, children = children }
    end
    local node: { [string]: any } =
        { type = "box", row = false, children = children, id = nil, gap = nil, padding = nil, bg = nil, layout = nil }
    for key, value in props do
        node[key] = value
    end
    return node
end

function plugin.row(children, props: { [string]: any }?)
    if not props then
        return { type = "box", row = true, children = children }
    end
    local node: { [string]: any } =
        { type = "box", row = true, children = children, id = nil, gap = nil, padding = nil, bg = nil, layout = nil }
    for key, value in props do
        node[key] = value
    end
    return node
end

-- What a slot or route render returns to show `node`.
function plugin.show(node)
    return { type = "show", node = node }
end

-- The action that runs command `name` with `input`.
function plugin.command(name: string, input: string?)
    return { type = "command", name = name, input = input }
end

-- A click that runs command `name` on the release of the left button.
function plugin.click(name: string, input: string?)
    return { action = { type = "command", name = name, input = input }, on = "up" }
end

return table.freeze(plugin)
