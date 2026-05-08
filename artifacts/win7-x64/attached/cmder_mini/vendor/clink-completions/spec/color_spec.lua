
local color = require('color')

describe("color module", function()

    it("should define color constants", function()
        assert.are.equals(color.BLACK,   0)
        assert.are.equals(color.RED,     1)
        assert.are.equals(color.GREEN,   2)
        assert.are.equals(color.YELLOW,  3)
        assert.are.equals(color.BLUE,    4)
        assert.are.equals(color.MAGENTA, 5)
        assert.are.equals(color.CYAN,    6)
        assert.are.equals(color.WHITE,   7)
        assert.are.equals(color.DEFAULT, 9)
        assert.are.equals(color.BOLD,    1)
    end)

    it("should export methods", function()
        assert.are.equal(type(color.set_color), 'function')
        assert.are.equal(type(color.get_clink_color), 'function')
        assert.are.equal(type(color.color_text), 'function')
    end)

    describe("'set_color' method", function ()

        local VALID_COLOR_STRING = "^\x1b%[(3%d);(%d%d?);(4%d)m$"

        it("should accept numeric arguments and return string", function ()
            assert.are.equal(type(color.set_color(1, 2, 3)), "string")
        end)

        it("should accept nil arguments and still return string", function ()
            assert.are.equal(type(color.set_color()), "string")
        end)

        it("should throw if first two arguments are not a numbers or nil", function ()
            assert.has.error(function() color.set_color('a', 2, 3) end)
            assert.has.error(function() color.set_color(1, 'a', 3) end)
        end)

        it("should throw if arguments is out of range", function ()
            assert.has.error(function() color.set_color(100, 1, 1) end)
            assert.has.error(function() color.set_color(1, 200, 1) end)
        end)

        it("should return valid ANSI color code", function ()
            -- TODO: either find appropriate assert or invent custom one
            -- assert_match(VALID_COLOR_STRING, color.set_color(3, 2, 1))
        end)

        it("should set color to DEFAULT if no corresponding argument was passed", function ()
            local _, _, fore, bold, back = string.find(color.set_color(), VALID_COLOR_STRING)
            assert.are.equals(fore, "39");
            assert.are.equals(back, "49");
            assert.are.equals(bold, "22");
        end)
    end)

    describe("'get_clink_color' method", function ()

        it("should do nothing since Clink support is only available in actual Clink", function ()
            assert.are.equals(color.get_clink_color('color.git.star'), "")
        end)
    end)

    describe("'color_text' method", function ()

        local TEST_STRING = "abc"
        local VALID_COLOR_STRING = "\x1b%[3%d;%d%d?;4%dm"

        it("should wrap string into valid ANSI codes", function ()
            -- TODO: either find appropriate assert or invent custom one
            -- assert_match("^"..VALID_COLOR_STRING..TEST_STRING..VALID_COLOR_STRING.."$",
            --     color.color_text(TEST_STRING, 1, 2, 3))
        end)

        it("should reset color to default", function ()
            local _,_, color_suffix = string.find(color.color_text(TEST_STRING, 1, 2, 3),
                "^"..VALID_COLOR_STRING..TEST_STRING.."("..VALID_COLOR_STRING..")$")
            assert.are.equals(color_suffix, color.set_color())
        end)
    end)
end)
