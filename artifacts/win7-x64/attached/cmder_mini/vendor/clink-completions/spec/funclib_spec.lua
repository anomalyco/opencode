
local map = require('funclib').map
local concat = require('funclib').concat
local filter = require('funclib').filter
local reduce = require('funclib').reduce

describe("funclib module", function()

    it("should export some methods", function()
        local methods_count = 0
        -- iterate through table to count keys rather than `use #... notation
        for _,_ in pairs(require("funclib")) do
            methods_count = methods_count + 1 end
        assert.are.equals(methods_count, 4)
    end)

    describe("'filter' function", function ()
        local test_table = {"a", "b", nil, false}

        it("should exist", function()
            assert.are.equals(type(filter), "function")
        end)

        it("should accept nil arguments", function()
            assert.has_no.errors(filter)
        end)

        it("should return empty table if input table is not specified", function()
            assert.are.same(filter(), {})
        end)

        it("should throw if first argument is not a table", function()
            assert.has_error(function() filter("aaa") end)
        end)

        it("should throw if second argument is not a function", function()
            assert.has_error(function() filter({"a", "b"}, "a") end)
            -- TODO: uncomment this
            -- assert.has_error(function() filter({}, "a") end)
        end)

        it("should filter out falsy values if no filter function specified", function()
            assert.are.same(filter(test_table), {"a", "b"})
        end)

        it("should filter out values which doesn't satisfy filter function", function()
            local function test_filter1(a) return a == "a" end
            local function test_filter2(a) return a == nil end
            assert.are.same(filter(test_table, test_filter1), {"a"})
            assert.are.same(filter(test_table, test_filter2), {nil})
        end)
    end)

    describe("'map' function", function ()
        local test_table = {"a", "b", "c"}

        it("should exist", function()
            assert.are.equals(type(map), "function")
        end)

        it("should accept nil arguments", function()
            assert.has_no.errors(map)
        end)

        it("should return empty table if input table is not specified", function()
            assert.are.same(map(), {})
        end)

        it("should throw if first argument is not a table", function()
            assert.has_error(function() map("aaa") end)
        end)

        it("should throw if second argument is not a function", function()
            assert.has_error(function() map(test_table, "a") end)
        end)

        it("should return original table if no map function specified", function()
            assert.are.same(map(test_table), test_table)
        end)

        it("should apply map function to all values", function()
            local function test_map(a) return a == "a" end
            assert.are.same(map(test_table, test_map), {true, false, false})
        end)
    end)

    describe("'reduce' function", function ()
        local test_table = {1, 2, 3}
        local _noop = function() end

        it("should exist", function()
            assert.are.equals(type(reduce), "function")
        end)

        it("should accept nil arguments (except reduce func)", function()
            assert.has_no.errors(function() reduce(nil, nil, _noop) end)
        end)

        it("should return accumulator if input table is not specified", function()
            assert.are.equals(reduce("accum", nil, _noop), "accum")
        end)

        it("should throw if second argument (source table) is not a table", function()
            assert.has_error(function() reduce({}, "aaa", _noop) end)
        end)

        it("should throw if third argument (reduce func) is not a function", function()
            assert.has_error(function() reduce({}, {}, "a") end)
            -- TODO: uncomment this
            -- assert.has_error(reduce)
        end)

        it("should apply reduce func to each element of source table", function()
            local function test_reduce(a, v) table.insert(a, v+1) return a end
            assert.are.same(reduce({}, test_table, test_reduce), {2, 3, 4})
        end)
    end)

    describe("'concat' function", function ()
        it("should exist", function()
            assert.are.equals(type(concat), "function")
        end)

        it("should accept nil arguments", function()
            assert.has_no.errors(concat)
        end)

        it("should return empty table if no input arguments specified", function()
            assert.are.same(concat(), {})
        end)

        it("should wrap non-table parameter into a table", function()
            local ret = concat("a")
            assert.is_not.equals(ret, {})
            assert.are.equals(type(ret), "table")
        end)

        it("should omit nil arguments", function()
            assert.are.same(concat("a", nil, "b"), {"a", "b"})
        end)

        it("should copy values from table params into result", function()
            assert.are.same(concat("a", {nil}, {"b"}), {"a", "b"})
        end)
    end)
end)
