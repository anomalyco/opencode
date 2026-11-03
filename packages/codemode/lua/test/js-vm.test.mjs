import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import { runLua } from "../index.js"

test("executes the unchanged VM regression fixture in JavaScript", () => {
  assert.deepEqual(runLua(readFileSync(new URL("vm.lua", import.meta.url), "latin1")), [])
})

test("only ungrouped calls and varargs at the end of an expression list expand", () => {
  assert.deepEqual(
    runLua(`
    local function pass(...) return ... end
    local function adjust(...) return pass(...), (...), (pass(...)) end
    local function none() end
    return select('#', none()), select('#', (none())), adjust(10,20)
  `),
    [0, 1, 10, 10, 10],
  )
})

test("declarations shadow cells without redirecting older closures", () => {
  assert.deepEqual(
    runLua(`
    local i = 0
    local f = function() return i end
    i = 7
    local i = 3
    local callbacks = {}
    for i = 1, 3 do callbacks[i] = function() return i end end
    return f(), i, callbacks[1](), callbacks[3]()
  `),
    [7, 3, 1, 3],
  )
})

test("Lua calls use explicit frames even when not in tail position", () => {
  assert.deepEqual(
    runLua(`
    local function depth(n)
      if n == 0 then return 0 end
      return 1 + depth(n-1)
    end
    return depth(4000)
  `),
    [4000],
  )
})

test("metamethod and iterator callbacks cannot yield across the 5.1 boundary", () => {
  assert.deepEqual(
    runLua(`
    local function check(f)
      local co = coroutine.create(f)
      local ok, msg = coroutine.resume(co)
      assert(type(msg) == 'string' and msg:match('boundary'))
      return ok, coroutine.status(co)
    end
    local a, b = check(function()
      local t = setmetatable({}, {__index = function() return coroutine.yield(1) end})
      return t.x
    end)
    return a, b, check(function() for x in coroutine.yield do end end)
  `),
    [false, "dead", false, "dead"],
  )
})

test("globals and string metatables are local to a chunk invocation", () => {
  assert.deepEqual(
    runLua(`
    getmetatable('').__index = { isolated = true }
    leaked = 9
    return ('').isolated
  `),
    [true],
  )
  assert.deepEqual(runLua(`return leaked, ('').isolated, ('abcd'):len()`), [null, null, 4])
})

test("public boundary rejects non-primitives and preserves byte strings and nils", () => {
  assert.throws(() => runLua("return {}"), /cannot return Lua table/)
  assert.deepEqual(runLua(String.raw`return nil, '\000\255', nil`), [null, "\0\xff", null])
})

test("protected calls preserve error values, arity, and the handler's first result", () => {
  assert.deepEqual(
    runLua(`
    local ok, err = pcall(error, 42, 0)
    assert(ok == false and err == 42)
    local function handler(value) return value, 'unused' end
    local function fail(...) assert(select('#', ...) == 0); error(false) end
    assert(select('#', xpcall(fail, handler, 99)) == 2)
    return xpcall(fail, handler, 99)
  `),
    [false, false],
  )
})

test("5.1 parser distinguishes an end string from the end keyword", () => {
  assert.deepEqual(runLua(`while true do break; end; return 'end'`), ["end"])
})
