import assert from 'node:assert/strict'
import test from 'node:test'
import { runLua } from '../index.js'

test('Lua 5.1 running() returns one nil on the main thread', () => {
  assert.deepEqual(runLua(`return coroutine.running()`), [null])
})

test('resume and yield exchange full tuples in both directions', () => {
  assert.deepEqual(runLua(`
    local co = coroutine.create(function(...)
      assert(select('#', ...) == 3)
      local function after(...)
        assert(select('#', ...) == 4)
        return ...
      end
      return after(coroutine.yield(...))
    end)
    local function check(...)
      assert(select('#', ...) == 4)
      local ok, a, b, c = ...
      assert(ok and a == nil and b == 'out' and c == nil)
    end
    check(coroutine.resume(co, nil, 'out', nil))
    return coroutine.resume(co, 'in', nil, false, nil)
  `), [true, 'in', null, false, null])
})

test('wrap omits the resume flag and distinguishes zero results from one nil', () => {
  assert.deepEqual(runLua(`
    local f = coroutine.wrap(function(initial)
      assert(initial == 19)
      assert(select('#', coroutine.yield()) == 0)
      return coroutine.yield(nil)
    end)
    assert(select('#', f(19)) == 0)
    assert(select('#', f()) == 1)
    return f('done', nil)
  `), ['done', null])
})

test('nested resume distinguishes running, normal, suspended and dead threads', () => {
  assert.deepEqual(runLua(`
    local parent, child
    child = coroutine.create(function()
      assert(coroutine.running() == child and coroutine.status(child) == 'running')
      assert(coroutine.status(parent) == 'normal')
      local ok, err = coroutine.resume(parent)
      assert(ok == false and type(err) == 'string')
      coroutine.yield()
    end)
    parent = coroutine.create(function()
      assert(coroutine.running() == parent and coroutine.status(parent) == 'running')
      local ok, err = coroutine.resume(parent)
      assert(ok == false and type(err) == 'string')
      assert(coroutine.status(child) == 'suspended')
      assert(coroutine.resume(child))
      assert(coroutine.status(child) == 'suspended')
      assert(coroutine.resume(child))
      assert(coroutine.status(child) == 'dead')
    end)
    assert(coroutine.status(parent) == 'suspended')
    assert(coroutine.resume(parent))
    local ok, err = coroutine.resume(parent)
    return coroutine.status(parent), ok, type(err)
  `), ['dead', false, 'string'])
})

test('resume returns the original error object; wrap throws it', () => {
  assert.deepEqual(runLua(`
    local marker = {}
    local function fail() coroutine.yield('ready'); error(marker) end
    local co = coroutine.create(fail)
    local started, value = coroutine.resume(co)
    assert(started and value == 'ready')
    local resumed, resumeError = coroutine.resume(co)
    local f = coroutine.wrap(fail)
    assert(f() == 'ready')
    local called, wrapError = pcall(f)
    return resumed, resumeError == marker, coroutine.status(co), called, wrapError == marker
  `), [false, true, 'dead', false, true])
})

test('pcall catches an illegal yield without suspending or killing the coroutine', () => {
  assert.deepEqual(runLua(`
    local co = coroutine.create(function()
      local ok, err = pcall(function() coroutine.yield('escaped') end)
      assert(ok == false and type(err) == 'string')
      coroutine.yield('recovered')
      return 'finished'
    end)
    local ok, result = coroutine.resume(co)
    assert(ok and result == 'recovered' and coroutine.status(co) == 'suspended')
    return coroutine.resume(co)
  `), [true, 'finished'])
})
