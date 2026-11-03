-- A tail call must close captured registers before reusing their frame.
local saved = {}
local function descend(n, ...)
  if n == 0 then return ... end
  if n % 1000 == 0 then saved[#saved+1] = function() return n end end
  return descend(n-1, ...)
end
local function pack(...) return {n = select('#', ...), ...} end
local results = pack(descend(100000, nil, 'middle', nil))
assert(results.n == 3 and results[2] == 'middle')
assert(saved[1]() == 100000 and saved[#saved]() == 1000)

-- Resume a yielded C call with open results across a Lua tail call.
local thread = coroutine.create(function(...)
  return descend(10, coroutine.yield(...))
end)
local ok, first = coroutine.resume(thread, 7)
assert(ok and first == 7)
results = pack(coroutine.resume(thread, false, nil, 9))
assert(results.n == 4 and results[1] and results[2] == false and results[4] == 9)

-- Metamethods can call Lua and grow the stack in the middle of an opcode.
local function grow(n)
  if n == 0 then collectgarbage(); return 0 end
  return 1 + grow(n-1)
end
local obj = setmetatable({}, {__index = function(_, key) return grow(300) + key end})
assert(obj[4] == 304)

-- Exercise the extra page word for a list wider than the SETLIST C field.
local wide = assert(loadstring('return {' .. string.rep('1,', 26000) .. '42}'))()
assert(#wide == 26001 and wide[26001] == 42)

local f, syntax = loadstring('local =')
assert(not f and type(syntax) == 'string')
local ok, err = pcall(assert(loadstring('local x\nreturn x.missing', '@bad.lua')))
assert(not ok and err:match('bad.lua:2:'))
print('VM regression tests passed')
