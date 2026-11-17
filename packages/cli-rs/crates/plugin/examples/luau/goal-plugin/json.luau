--!strict
-- A JSON reader: a Luau plugin has none from the host, and the goal tools' results are JSON in text. `null` reads as
-- `json.null`, so a field that is `null` is told from one that is missing. Returns nil for text that is not JSON.
local json = {}

json.null = table.freeze({})

local ESCAPES: { [string]: string } = { ['"'] = '"', ["\\"] = "\\", ["/"] = "/", b = "\b", f = "\f", n = "\n", r = "\r", t = "\t" }

function json.decode(text: string): any
    local at = 1
    local function fail(): never
        error("not json", 0)
    end
    local function blank()
        at = (text:find("[^ \t\r\n]", at) or #text + 1)
    end
    local value: () -> any
    local function word(literal: string, result: any): any
        if text:sub(at, at + #literal - 1) ~= literal then
            fail()
        end
        at += #literal
        return result
    end
    local function str(): string
        at += 1
        local out: { string } = {}
        while true do
            local char = text:sub(at, at)
            if char == "" then
                fail()
            elseif char == '"' then
                at += 1
                return table.concat(out)
            elseif char == "\\" then
                local escape = text:sub(at + 1, at + 1)
                if escape == "u" then
                    local code = tonumber(text:sub(at + 2, at + 5), 16) or fail()
                    at += 6
                    -- A surrogate pair is one character.
                    if code >= 0xD800 and code <= 0xDBFF and text:sub(at, at + 1) == "\\u" then
                        local low = tonumber(text:sub(at + 2, at + 5), 16) or fail()
                        code = 0x10000 + (code - 0xD800) * 0x400 + (low - 0xDC00)
                        at += 6
                    end
                    table.insert(out, utf8.char(code))
                else
                    table.insert(out, ESCAPES[escape] or fail())
                    at += 2
                end
            else
                local stop = text:find('["\\]', at) or #text + 1
                table.insert(out, text:sub(at, stop - 1))
                at = stop
            end
        end
    end
    function value(): any
        blank()
        local char = text:sub(at, at)
        if char == "{" then
            at += 1
            local object = {}
            blank()
            if text:sub(at, at) == "}" then
                at += 1
                return object
            end
            while true do
                blank()
                if text:sub(at, at) ~= '"' then
                    fail()
                end
                local key = str()
                blank()
                if text:sub(at, at) ~= ":" then
                    fail()
                end
                at += 1
                object[key] = value()
                blank()
                local next = text:sub(at, at)
                at += 1
                if next == "}" then
                    return object
                elseif next ~= "," then
                    fail()
                end
            end
        elseif char == "[" then
            at += 1
            local array = {}
            blank()
            if text:sub(at, at) == "]" then
                at += 1
                return array
            end
            while true do
                table.insert(array, value())
                blank()
                local next = text:sub(at, at)
                at += 1
                if next == "]" then
                    return array
                elseif next ~= "," then
                    fail()
                end
            end
        elseif char == '"' then
            return str()
        elseif char == "t" then
            return word("true", true)
        elseif char == "f" then
            return word("false", false)
        elseif char == "n" then
            return word("null", json.null)
        end
        local matched = text:match("^-?%d+%.?%d*[eE]?[-+]?%d*", at)
        if not matched or matched == "" or matched == "-" then
            fail()
        end
        local number = matched :: string
        at += #number
        return tonumber(number) or fail()
    end
    local ok, result = pcall(function()
        local read = value()
        blank()
        if at <= #text then
            fail()
        end
        return read
    end)
    return if ok then result else nil
end

return table.freeze(json)
