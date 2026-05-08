local concat = require('funclib').concat
local filter = require('funclib').filter
local map = require('funclib').map
local reduce = require('funclib').reduce

local exports = {}

local wrap_filter = function (tbl, filter_func)
    return exports.wrap(filter(tbl, filter_func))
end

local wrap_map = function (tbl, map_func)
    return exports.wrap(map(tbl, map_func))
end

local wrap_reduce = function (tbl, accum, reduce_func)
    local res = reduce(accum, tbl, reduce_func)
    return (type(res) == "table" and exports.wrap(res) or res)
end

local wrap_concat = function (tbl, ...)
    return exports.wrap(concat(tbl, ...))
end

local wrap_print = function (tbl)
    return exports.wrap(filter(tbl, function (item)
        print(item)
        return true
    end))
end

exports.wrap = function (tbl)
    if tbl == nil then tbl = {} end
    if type(tbl) ~= "table" then tbl = {tbl} end

    local mt = getmetatable(tbl) or {}
    mt.__index = mt.__index or {}
    mt.__index.filter = wrap_filter
    mt.__index.map = wrap_map
    mt.__index.reduce = wrap_reduce
    mt.__index.concat = wrap_concat
    mt.__index.print = wrap_print
    mt.__index.keys = function (arg)
        local res = {}
        for k,_ in pairs(arg) do
            table.insert(res, k)
        end
        return exports.wrap(res)
    end
    mt.__index.sort = function (arg)
        table.sort(arg)
        return arg
    end
    mt.__index.dedupe = function (arg)
        local res, hash = {}, {}
        for _,v in ipairs(arg) do
            if not hash[v] then
                hash[v] = true
                table.insert(res, v)
            end
        end
        return exports.wrap(res)
    end
    mt.__index.contains = function (arg, value)
        for _,v in ipairs(arg) do
            if v == value then return true, _ end
        end
        return false
    end

    return setmetatable(tbl, mt)
end

return exports
