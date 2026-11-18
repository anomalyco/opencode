--!strict
-- `@opencode/plugin`: what every Luau plugin requires. `define` names the setup; the rest builds the contract's tables
-- (`schema/v2.json`), which a plugin may also write by hand. Types: `opencode/plugin.luau`.
--
-- Each helper builds its table in one record literal. A literal with only named fields is a copy of a template made
-- when the chunk loads (`DUPTABLE`), and a field written `= nil` still gets its slot in the template. So a helper given
-- `props` starts from a table that already has room for the common fields, and copying `props` into it does not grow
-- it. A helper given no `props` builds the smallest table and runs no loop.

-- What the host hands this chunk: `fail(message, frames)` fails the running call with `message` and the `frames` of
-- a traceback, if any, though nothing more can be allocated to raise it; `native`, what `plugin.json` is built on (its `decode`, `encode`, `null` and markers).
local fail: (string, string?) -> never, native: any = ...

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
-- `host:select`, `host:prompt`, `host:confirm`, `host:alert`, `plugin.all`, `plugin.sleep`) parks its task and returns once its answer
-- comes, in the host call that carries the answer: a reply's, or the dialog's answer or close. So what a task asks for
-- after a wait is among the effects of that call, timed and limited as that call is: the CPU budget holds for each stretch
-- between two waits, and a parked task costs no time. A render, a view, a search, `onDispose` and setup are not tasks,
-- and a waiting call there fails; setup may start one with `plugin.spawn`.
--
-- A task keeps the owner of the handler that started it: what it asks for, after a wait as before, is that mount's, or
-- the activation's, whichever call goes on with it; a task `plugin.spawn` starts has its starter's owner.
--
-- A task parked when its plugin is disabled, fails or reloads is dropped with the VM and never goes on. A task parked on
-- a request whose mount closes before the reply goes on once with `nil, "cancelled"`: the host cancelled the request.

-- What a task's coroutine yields once its function returned, ready for the next, and what a waiting call yields. Any
-- other yield is the plugin's own `coroutine.yield`, which fails the task.
local ENDED, PARK = table.freeze({}), table.freeze({})

-- This chunk runs before the VM is sandboxed, so a global it names is looked up in full at each use: the hot ones are
-- upvalues.
local create, resume, yield, running = coroutine.create, coroutine.resume, coroutine.yield, coroutine.running
local isyieldable = coroutine.isyieldable
local clone, pack, unpack, select = table.clone, table.pack, table.unpack, select

-- The most tasks a plugin may have parked at once; a waiting call past it fails.
local PARKED = 256

-- The coroutines that are tasks: only they may wait.
local tasks: { [thread]: boolean } = setmetatable({}, { __mode = "k" }) :: any
local parked = 0
-- What each parked task lets go of if it ends or fails without its answer: its request's or its dialog's entry.
local held: { [thread]: () -> () } = {}
-- A task's coroutine whose last function returned without waiting, kept for the next task.
local idle: thread? = nil

-- A task's coroutine: runs `f(a, b, c)`, yields `ENDED` and its first result, and runs the next function it is resumed
-- with. A task takes at most three arguments; `plugin.spawn` packs more into a closure.
local function worker(f, a, b, c)
    while true do
        f, a, b, c = yield(ENDED, (f(a, b, c)))
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

-- Resume a parked task under the mount that owned it when it yielded, regardless of which call wakes it.
local owners: { [thread]: number } = {}
local ownerOf: (() -> number)? = nil
local setOwner: ((number?) -> ())? = nil
local forced: number? = nil

-- Lets go of what task `co` waited on, if anything: it ended or failed without its answer.
local function release(co: thread)
    local let = held[co]
    owners[co] = nil
    if let then
        held[co] = nil
        parked -= 1
        let()
    end
end

-- The length past which a task's error fails its call by the latch (`fail`), not raised: 16 times what the host keeps.
local HUGE_ERROR = 64 * 1024

-- What resuming task `co` gave: whether its function ended, and its first result. An error in the task, or a yield of
-- the plugin's own, is raised again with the task's traceback, so the host call fails and the plugin with it.
local function settle(co: thread, ok: boolean, mark: any, result: any): (boolean, any)
    if mark == PARK and ok then
        return false, nil
    end
    release(co)
    if ok and mark == ENDED then
        if idle == nil then
            idle = co
        end
        return true, result
    end
    tasks[co] = nil
    if ok then
        mark = "coroutine.yield in a task: only a waiting call (host:fetch, a dialog, plugin.all) may pause it"
    end
    -- An error far longer than the host keeps of it (4 KiB) fails the call by the latch, with the task's frames apart.
    -- Copied into one string with them, and raised to be copied again into the host's traceback, it can run the heap
    -- out, and lose its frames or all of it ("error in error handling").
    if type(mark) == "string" and #mark > HUGE_ERROR then
        local built, frames = pcall(traceback, co, "")
        fail(mark, if built then frames else nil)
    end
    local built, text = false, nil
    if mark ~= "not enough memory" then
        built, text = pcall(traceback, co, mark)
    end
    if not built then
        -- Out of memory. The task is no longer held, so its stack goes with the next collection. Not `coroutine.close`:
        -- resetting the coroutine reallocates its stack, which with the heap full raises the memory error on the
        -- coroutine's own state while this one runs, and Luau aborts the process on that.
        fail(if type(mark) == "string" then mark else "not enough memory")
    end
    error(text, 0)
end

-- Runs `f(a, b, c)` as a task, on the idle coroutine or a new one: whether it ended without waiting, and its first
-- result.
local function run(f, a, b, c): (boolean, any)
    local co = idle
    idle = nil
    if co == nil then
        co = create(worker)
        tasks[co] = true
    end
    local ok, mark, result = resume(co, f, a, b, c)
    -- Most handlers return without waiting: their worker goes back at once.
    if ok and mark == ENDED and idle == nil and held[co] == nil then
        idle = co
        return true, result
    end
    return settle(co, ok, mark, result)
end

-- Goes on with parked task `co`, whose entry its waker removed, its waiting call returning `...`, under its own owner;
-- the call gets the owner it had back after, also when the task fails.
local function wake(co: thread, ...)
    held[co] = nil
    parked -= 1
    local owner, outer, set = owners[co], forced, setOwner
    owners[co] = nil
    local switch = set ~= nil and owner ~= nil and owner ~= outer
    if switch then
        forced = owner;
        (set :: (number?) -> ())(owner)
    end
    local ok, mark, result = resume(co, ...)
    if switch then
        forced = outer;
        (set :: (number?) -> ())(outer)
    end
    settle(co, ok, mark, result)
end

-- The running task, or an error naming waiting call `name` at the plugin's line `level` frames up: outside a task,
-- where the task cannot pause (inside a C function such as `table.sort`'s comparator), or past the cap.
local function task(name: string, level: number): thread
    local co = running()
    if not tasks[co] then
        error(
            `{name} waits, and only a task can: a command's, an event's, a mount's, a layer's or a surface's handler, or plugin.spawn`,
            level
        )
    end
    if not isyieldable() then
        error(
            `{name} cannot wait here: a task cannot pause inside table.sort, string.gsub, xpcall, require or a metamethod`,
            level
        )
    end
    if parked >= PARKED then
        error(`{name}: more than {PARKED} tasks of the plugin wait`, level)
    end
    return co
end

-- Parks task `co` until `wake` goes on with it, and returns what `wake` was given. `let` removes its entry, if the
-- task ends or fails without its answer.
local function park(co: thread, let: () -> ()): ...any
    parked += 1
    held[co] = let
    if ownerOf then
        owners[co] = (ownerOf :: () -> number)()
    end
    return yield(PARK)
end

-- Starts `f(...)` as a task of its own, from a handler, from another task or from setup. It runs until it ends or
-- waits, then the caller goes on.
function plugin.spawn(f: (...any) -> ...any, ...)
    if select("#", ...) <= 3 then
        run(f, ...)
        return
    end
    local args = pack(...)
    run(function()
        return f(unpack(args, 1, args.n))
    end)
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
                waiting = false
                wake(co)
            end
        end)
    end
    if left > 0 then
        waiting = true
        park(co, function()
            waiting = false
        end)
    end
    if failure ~= nil then
        return nil, failure
    end
    return results, nil
end

-- Typed calls ---------------------------------------------------------------------------------------------------------
--
-- `plugin.client.session.inbox.list({ sessionID = id })` sends operation `session.inbox.list` of the API and waits
-- for it, as `host:fetch` does: it returns the operation's output (the reply's `data` where the operation answers in
-- `data`, the base64 of the bytes of one that answers with bytes), or `nil, err`. The host builds the request from the
-- generated operations table, with the encodings of the API's own client, and refuses an operation it does not have,
-- a required field left out and a field the operation does not take. Only a task can wait, as for `host:fetch`.

-- The waiting call of the running plugin's setup, once setup has run.
local calling: ((string, any) -> (any, string?))? = nil

-- The namespace of operations under `prefix` (`session`, `session.inbox`); called, it is that operation.
local namespaces: { [string]: any } = {}
local function namespace(prefix: string): any
    local known = namespaces[prefix]
    if known then
        return known
    end
    local space = setmetatable({}, {
        __index = function(_, key: string)
            return namespace(if prefix == "" then key else `{prefix}.{key}`)
        end,
        __call = function(_, input: any)
            if calling == nil then
                error(`plugin.client.{prefix} waits, and only a task can: a handler of setup's, or plugin.spawn`, 2)
            end
            return calling(prefix, input)
        end,
        __newindex = function()
            error("plugin.client is read-only", 2)
        end,
    })
    namespaces[prefix] = space
    return space
end
plugin.client = namespace("")

-- What `plugin.sleep` asks the host through, and the host `plugin.every` hands its function: the plugin's, once
-- `plugin.define`'s setup started.
local sleeper: ((number) -> (any, string?))? = nil
local ticked: any = nil

-- Waits `ms` milliseconds on the host's clock, at least 20 and a part of one kept, with no thread (`math.huge` waits for
-- ever): `true`, or `nil` and why the host took no timer (32 of the plugin wait) or cancelled it (`"cancelled"`, its
-- mount closed). Only a task waits.
function plugin.sleep(ms: number): (boolean?, string?)
    local sleep = sleeper
    if sleep == nil then
        error("plugin.sleep needs a plugin of plugin.define", 2)
    end
    local _, err = sleep(ms)
    if err ~= nil then
        return nil, err
    end
    return true, nil
end

-- Runs `f(host)` every `ms` milliseconds in a task of its own, until `f` returns `false` or a sleep fails. A tick that
-- runs long delays the next: a late period is one tick, not one for each it missed. Started from a mount's handler, it
-- is that mount's task, as what its ticks ask for is, and ends when the mount closes.
function plugin.every(ms: number, f: (any) -> boolean?)
    plugin.spawn(function()
        while plugin.sleep(ms) do
            if f(ticked) == false then
                return
            end
        end
    end)
end

-- Reserve each answer command until its dialog answers or closes. If all slots are held, return nil immediately.
-- Command names and generations must match the Rust SDK.
local SLOTS = 64

-- The setup object a plugin's setup gets: the host's, with each handler a task, the waiting calls on `host`, and the
-- hidden commands the dialogs answer and close through. The reply and cancel handlers are this module's.
local function tasked(raw)
    local host = raw.host
    local fetch, foreground, dialog = host.fetch, host.foreground, host.dialog
    local closed = `{raw.id}.task.closed`
    -- Requests in flight, by ID, and the dialogs shown by tasks that have not closed, by number, with what they ask.
    local requests: { [number]: thread } = {}
    local dialogs: { [number]: { co: thread, kind: string, slot: number? } } = {}
    -- The dialog that holds each answer command, until its answer or its close runs.
    local slots: { [number]: number } = {}
    -- Frees the answer command dialog `number` holds, if it holds one.
    local function free(number: number)
        local asked = dialogs[number]
        if asked and asked.slot and slots[asked.slot] == number then
            slots[asked.slot] = nil
        end
    end
    local shown = 0

    local function request(name: string, send, self, spec, level: number?): (any, string?)
        local co = task(name, level or 4)
        local id, why = send(self, spec)
        if id == nil then
            return nil, why
        end
        requests[id] = co
        return park(co, function()
            requests[id] = nil
        end)
    end
    host.fetch = function(self, spec)
        return request("host:fetch", fetch, self, spec)
    end
    host.foreground = function(self, spec)
        return request("host:foreground", foreground, self, spec)
    end
    -- `plugin.client`'s calls: the host builds and sends the request, and says how its reply reads.
    local call = host.call
    host.call = nil
    calling = function(name: string, input: any): (any, string?)
        local co = task(`plugin.client.{name}`, 4)
        local id, why, reply = call(host, name, input)
        if id == nil then
            return nil, why
        end
        requests[id] = co
        local body, err = park(co, function()
            requests[id] = nil
        end)
        if err ~= nil then
            return nil, err
        end
        if reply ~= "data" then
            return body, nil
        end
        if type(body) ~= "table" then
            return nil, "the reply is not an object with data"
        end
        return body.data, nil
    end
    -- The timer is `plugin.sleep`'s alone, and the owner calls the tasks' own.
    local timer = host.timer
    host.timer = nil
    local owner, setOwnerOf = host.owner, host.setOwner
    host.owner, host.setOwner = nil, nil
    ownerOf = function(): number
        return owner(host)
    end
    setOwner = function(id: number?)
        setOwnerOf(host, id)
    end
    sleeper = function(ms: number)
        return request("plugin.sleep", timer, host, ms, 5)
    end
    ticked = host
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
    -- A request its mount's close cancelled gets no reply: its task goes on with the error in its place.
    raw.onCancelled(raw, function(_, id: number)
        local co = requests[id]
        if co then
            requests[id] = nil
            wake(co, nil, "cancelled")
        end
    end)

    -- Shows `spec` as a dialog of `kind` and parks until it is answered (the answer) or closes without one (`nil`).
    local function ask(name: string, self, kind: string, spec): any
        local co = task(name, 4)
        shown += 1
        local number = shown
        local shape: { [string]: any } = clone(spec)
        shape.type = kind
        -- A keyed select stays open on a pick and is replaced in place without its close: the task would never hear.
        shape.key = nil
        local slot: number? = nil
        if kind ~= "alert" then
            for at = 0, SLOTS - 1 do
                if slots[at] == nil then
                    slot = at
                    break
                end
            end
            if slot == nil then
                return nil
            end
            slots[slot] = number
            shape.action = { type = "command", name = `{raw.id}.task.answer.{slot}` }
        end
        dialogs[number] = { co = co, kind = kind, slot = slot }
        dialog(self, {
            type = "dismissable",
            dialog = shape,
            dismissed = { type = "command", name = closed, input = tostring(number) },
        })
        return park(co, function()
            free(number)
            dialogs[number] = nil
        end)
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
    -- An answer is for the dialog that holds its command, which it frees: the host closes it and runs its action, then
    -- its close.
    for slot = 0, SLOTS - 1 do
        raw.command(raw, { name = `{raw.id}.task.answer.{slot}` }, function(_, input: string?)
            local number = slots[slot]
            slots[slot] = nil
            local asked = number and dialogs[number]
            if asked then
                dialogs[number :: number] = nil
                local value = input or ""
                wake(asked.co, if asked.kind == "confirm" then value == "true" else value)
            end
        end)
    end
    -- A close of a dialog still unanswered: an escape, the backdrop, another dialog in its place, an alert's `ok`, or
    -- a dialog the host did not show (its own dialog was open).
    raw.command(raw, { name = closed }, function(_, input: string?)
        local number = tonumber(input)
        local asked = number and dialogs[number]
        if asked then
            free(number :: number)
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
    -- A command that returns "pass" declines the key that ran it, which goes on to whatever else takes it; one that
    -- waits has taken it.
    local function commanded(handler)
        return function(a, b)
            local ended, result = run(handler, a, b)
            if ended and result == "pass" then
                return "pass"
            end
            return nil
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
        command = acting("command", commanded),
        onEvent = acting("onEvent", plain),
        onRouteMount = acting("onRouteMount", plain),
        -- The slot's input is a table the host fills again for its next call: a task that waits keeps a copy.
        onMount = acting("onMount", function(handler)
            return function(h, input, mounted)
                local copy = clone(input)
                if copy.prompt then
                    copy.prompt = clone(copy.prompt)
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

-- JSON --------------------------------------------------------------------------------------------------------------
--
-- `plugin.json` reads and writes JSON with the host's `serde_json`, under the bounds any value a plugin hands the host
-- is held to: its text, its depth and its parts. Luau has one table for JSON's arrays and objects: a table is an array
-- when its keys are `1..n` (an empty table is one), an object otherwise, and a table with the object marker is an
-- object whatever its keys. A table the host builds from JSON (`decode`, a reply, `setup.options`, `storageGet`)
-- carries the marker of what it was, so an empty object goes back as `{}`.

local json = {}

-- JSON's `null` where a table must hold it: what `decode` gives with `{ null = true }`, and what the host reads as
-- `null` in anything a plugin hands it (`encode`, a request's body, storage).
json.null = native.null

local ARRAY, OBJECT = native.array, native.object

-- `text` as a value and `nil`, or `nil` and why: text that is not JSON, or past the bounds. A `null` field is left out
-- and a `null` item is `plugin.json.null`, as the host hands values over; with `{ null = true }` every `null` is
-- `plugin.json.null`, so a field that is `null` is told from one that is missing.
function json.decode(text: string, options: { null: boolean? }?): (any, string?)
    if type(text) ~= "string" then
        error("plugin.json.decode needs a string", 2)
    end
    return native.decode(text, options ~= nil and options.null == true)
end

-- The JSON text of `value`. A function, a thread, userdata or a number that is not finite cannot be written.
function json.encode(value: any): string
    return native.encode(value)
end

-- Whether table `t` goes to JSON as an array: not when it has the object marker, else when its keys are `1..n`.
function json.isArray(t: { [any]: any }): boolean
    if getmetatable(t) == OBJECT then
        return false
    end
    local count = 0
    for _ in t do
        count += 1
    end
    return count == #t
end

-- Marks table `t` an array, and returns it: an empty one goes to JSON as `[]`.
function json.array<T>(t: T): T
    return setmetatable(t :: any, ARRAY)
end

-- Marks table `t` an object, and returns it: an empty one goes to JSON as `{}`, and keys `1..n` as `"1"` to `"n"`.
function json.object<T>(t: T): T
    return setmetatable(t :: any, OBJECT)
end

plugin.json = table.freeze(json)

-- Sorts `list` in place by `less` (`a < b` when left out) and returns it. Equal items keep their order, as in
-- JavaScript's `Array.prototype.sort`; `table.sort`'s do not.
function plugin.sort<T>(list: { T }, less: ((T, T) -> boolean)?): { T }
    local n = #list
    if n < 2 then
        return list
    end
    local before: (T, T) -> boolean = less or function(a: any, b: any)
        return a < b
    end
    -- Runs of `width` merged in pairs, from one buffer into the other, an item of the right run first only when it is
    -- strictly less.
    local from, to = list, table.create(n)
    local width = 1
    while width < n do
        local low = 1
        while low <= n do
            local middle, high = math.min(low + width, n + 1), math.min(low + 2 * width, n + 1)
            local left, right, at = low, middle, low
            while left < middle and right < high do
                if before(from[right], from[left]) then
                    to[at], right = from[right], right + 1
                else
                    to[at], left = from[left], left + 1
                end
                at += 1
            end
            table.move(from, left, middle - 1, at, to)
            table.move(from, right, high - 1, at + middle - left, to)
            low = high
        end
        from, to = to, from
        width *= 2
    end
    if from ~= list then
        table.move(from, 1, n, 1, list)
    end
    return list
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
