import assert from "node:assert/strict"
import test from "node:test"
import { evaluateLua, hostFailure, LuaFault } from "../sandbox.js"

const options = { paths: [["tools"]] }
function resume(vm, reply) {
  let step = vm.next(reply)
  while (!step.done && step.value.type === "tick") step = vm.next()
  return step
}
function run(source, bindings) {
  const step = resume(evaluateLua(source, { ...options, bindings }))
  assert.equal(step.done, true)
  return step.value
}
function fault(source, kind, message) {
  assert.throws(
    () => run(source),
    (e) => e instanceof LuaFault && e.kind === kind && message.test(e.message),
  )
}

test("host suspension preserves frames, locals and multiple return values across interleaved VMs", () => {
  const source = `local function invoke(n)
    local function nested() return tools.ns["fetch-item"]({n=n}), n end
    return nested()
  end
  local item,n=invoke(input); item.n=n; return item`
  const a = evaluateLua(source, { ...options, bindings: { input: "雪" } })
  const b = evaluateLua(source, { ...options, bindings: { input: 2 } })
  const first = resume(a).value
  assert.deepEqual(first.path, ["tools", "ns", "fetch-item"])
  assert.equal(first.args[0].n, "雪")
  assert.equal(resume(b).value.args[0].n, 2)
  const original = { n: 9 }
  assert.equal(resume(b, original).value.n, 2)
  assert.equal(resume(a, original).value.n, "雪")
  assert.deepEqual(original, { n: 9 })
})

test("cancellation at either checkpoint cannot run the next statement", () => {
  const busy = evaluateLua("for i=1,200000 do end; return tools.finished()", options)
  assert.equal(busy.next().value.type, "tick")
  assert.deepEqual(busy.return(), { done: true, value: undefined })
  assert.equal(busy.next().done, true)
  const parked = evaluateLua("pcall(tools.first); return tools.second()", options)
  assert.deepEqual(resume(parked).value.path, ["tools", "first"])
  assert.equal(parked.return().done, true)
  assert.equal(parked.next("late reply").done, true)
})

test("protected host calls unwind on ordinary errors, not interruption; errors keep Lua identity", () => {
  const vm = evaluateLua(
    `local function f() return tools.fail() end
    local ok,err=pcall(f)
    assert(not ok and err == 'unavailable 雪')
    local obj={}; local good,same=pcall(error,obj); assert(not good and same==obj)
    local outer,inner,num=pcall(pcall,function() return 12 end); assert(outer and inner and num==12)
    return tools.done()`,
    options,
  )
  assert.equal(resume(vm).value.protected, true)
  const done = resume(vm, hostFailure("unavailable 雪"))
  assert.deepEqual(done.value.path, ["tools", "done"])
  assert.equal(done.value.protected, false)
  assert.equal(resume(vm, true).value, true)
})

test("finite work budgets cover empty bodies, tail calls, scopes and nested pcall", () => {
  for (const source of [
    "for i=1,1000000 do end",
    "local i=0; repeat i=i+1 until i==1000000",
    "local i=0; while i<1000000 do i=i+1 end",
    "local function tail(n) if n==0 then return end; return tail(n-1) end; tail(1000000)",
  ])
    fault(`return pcall(function() ${source} end)`, "ExecutionFailure", /work limit/)
  fault("local function f() return 1+f() end; return pcall(f)", "ExecutionFailure", /stack overflow/)
  fault("local function f() return pcall(f) end; return pcall(f)", "ExecutionFailure", /depth limit/)
})

test("growing tables, strings and native operations charge before materialization", () => {
  for (const [source, msg] of [
    ["return string.rep('x',2^40)", /size limit/],
    ["local t={} for i=1,9000 do t[i]=i end", /entry limit/],
    ["local s='a' for i=1,22 do s=s..s end", /size limit/],
    ["return table.concat({}, '', 1, 2^50)", /concat range/],
    ["local s=string.rep('x',200000); for i=1,64 do string.lower(s) end", /allocation limit/],
    ["local t=tools; for i=1,64 do t=t.x end", /path exceeds/],
  ])
    fault(`return pcall(function() ${source} end)`, "ExecutionFailure", msg)
  assert.equal(run('return table.concat({("abc"):upper(),("world"):sub(2,-2),string.rep("!",2)}, " ")'), "ABC orl !!")
  assert.equal(
    run("return string.find == nil and string.gsub == nil and string.format == nil and table.sort == nil"),
    true,
  )
})

test("the JSON boundary preserves data, rejects unsafe values and bounds expanded DAGs", () => {
  assert.deepEqual(run("return {x[1],x[2],json.null,json.array()}", { x: [null, "λ"] }), [null, "λ", null, []])
  assert.deepEqual(run("return {}"), Object.create(null))
  assert.equal(run("return #{'a'}, 200"), 1)
  assert.equal(run("return #'💫'"), 4)
  assert.equal(run("return nil"), undefined)
  for (const source of [
    "return {[2]=1}",
    "return {1,b=2}",
    "return {tool=tools.call}",
    "return 0/0",
    "local t={};t.self=t;return t",
    "return '\\255'",
    "return {__proto__={}}",
  ])
    fault(source, "InvalidDataValue", /Lua|JSON|Circular|contiguous/)
  fault("local t=1; for i=1,30 do t={t,t} end return t", "ExecutionFailure", /work limit/)
  fault("local s=string.rep('\\000',200000); return s", "InvalidDataValue", /boundary byte limit/)
})

test("no JS prototypes, ambient libraries, loaders, raw VM objects or host method lookup", () => {
  assert.equal(
    run(
      `return os==nil and io==nil and require==nil and package==nil and debug==nil and coroutine==nil and load==nil and loadstring==nil and _G==nil and getfenv==nil and setmetatable==nil and string.dump==nil and ({}).constructor==nil and ('').constructor==nil and ('').__proto__==nil`,
    ),
    true,
  )
  assert.throws(
    () => resume(evaluateLua("return fetch.constructor()", { paths: [["fetch"]] })),
    /Cannot index Lua function/,
  )
  assert.throws(() => run("return string.rep.constructor"), /Cannot index Lua function/)
  assert.throws(() => run("table.insert = 1"), /read-only/)
  assert.throws(() => run("tools = {}"), /reserved/)
  assert.equal(run("local tools=5; return tools"), 5)
})

test("parser limits run before evaluation and diagnostics retain the failing line", () => {
  fault("return '" + "x".repeat(32768) + "'", "ParseError", /source exceeds/)
  fault("return " + "{".repeat(10000) + "1" + "}".repeat(10000), "ParseError", /nesting/)
  fault("return " + "1+".repeat(2000) + "1", "ParseError", /nesting/)
  fault("--[" + "=".repeat(1000) + "[", "ParseError", /delimiter/)
  assert.throws(
    () => run("local a={}\nreturn a.missing()"),
    (e) => e.location.line === 2,
  )
  assert.equal(run("return 7"), 7)
})
