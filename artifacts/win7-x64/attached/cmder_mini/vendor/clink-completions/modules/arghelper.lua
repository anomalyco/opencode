--------------------------------------------------------------------------------
-- Helpers to make it easy to add descriptions in argmatchers.
--
--      argmatcher:_addexflags()
--      argmatcher:_addexarg()
--
-- The _addexflags() and _addexarg() functions accept the following format,
-- and both functions accept the same input format.
--
--      local a = clink.argmatcher()
--
--      a:_addexflags({
--          nosort=true,                    -- Disables sorting the matches.
--          some_function,                  -- Adds some_function.
--          "-a",                           -- Adds match "-a".
--          { "-b" },                       -- Adds match "-b".
--          { "-c", "Use colors" },         -- Adds match "-c" and description "Use colors".
--          { "-d", " date",  "List newer than date" },
--                                          -- Adds string "-d", arginfo " date", and
--                                             description "List newer than date".
--          { "-D", " date",  "" },         -- Adds string "-D" and arginfo " date",
--                                             without a description.
--          {                               -- Nested table, following the same format.
--              { "-e" },
--              { "-f" },
--          },
--          { "-o" },
--          { "--option" },
--
--          -- Add hide=true to hide the match.
--          { "-x", hide=true },
--
--          -- Use hide_unless="list of flags" to hide the match unless any of
--          -- the specified flags are present.
--          { hide_unless="-o --option", "--no-option" },
--
--          -- Add opteq=true when there's a linked argmatcher to also add a
--          -- hidden opposite style:
--          { "-x"..argmatcher, opteq=true },   -- Adds "-x"..argmatcher, and a hidden "-x="..argmatcher.
--          { "-x="..argmatcher, opteq=true },  -- Adds "-x="..argmatcher, and a hidden "-x"..argmatcher.
--          -- Also, adding opteq=true or opteq=false to an outer table applies
--          -- to everything nested within the table.
--      })
--
-- The arghelper script also fills in compatibility methods for any of the
-- following argmatcher methods that may be missing in older versions of Clink.
-- This makes backward compatibility much easier, because your code can use
-- newer APIs and they'll just do nothing if the version of Clink in use doesn't
-- actually support them.
--
--      argmatcher:addarg()
--      argmatcher:addflags()
--      argmatcher:nofiles()
--      argmatcher:adddescriptions()
--      argmatcher:hideflags()
--      argmatcher:setflagsanywhere()
--      argmatcher:setendofflags()
--
-- The arghelper script also returns an export table with additional helper
-- functions.
--
--      local arghelper = require("arghelper")
--      arghelper.make_arg_hider_func()
--
-- Use the arghelper.make_arg_hider_func() function to create and return a match
-- function that omits the specified matches when displaying or completing
-- matches, while still letting input coloring apply color to them.  If
-- make_arg_hider_func() is used more than once in the same argument position,
-- only the last one will take effect.
--
--      local arghelper = require("arghelper")
--
--      clink.argmatcher("foo")
--      :addarg({
--          "abc", "def",
--          "Abc", "Def",
--          arghelper.make_arg_hider_func("Abc", "Def")
--      })
--
-- The arghelper.make_arg_hider_func() accepts as many arguments as you like,
-- and the argument types can be tables, functions, and strings.
--
--      - Strings are added to the list of matches to hide.
--      - Functions can return more arguments.
--      - Tables can contain more arguments (tables, functions, and strings).
--
--      clink.argmatcher("foo")
--      :addarg({
--          "abc", "def",
--          "Abc", "Def",
--          "ABC", "DEF",
--          arghelper.make_arg_hider_func({
--              {"Abc", "ABC"},
--              function ()
--                  return {"Def", "DEF"}
--              end
--          })
--      })
--
--------------------------------------------------------------------------------
-- Changes:
--
--  2023/11/18
--      - Support for `hide=true` in _addexarg().
--
--  2023/11/14
--      - Support for `onadvance=func` and `onlink=func`.
--
--  2023/01/29
--      - `local arghelper = require("arghelper.lua")` returns an export table.
--      - `arghelper.make_arg_hider_func()` makes a match function that hides
--        specified args.
--
--  2022/10/22
--      - Support for `onarg=func`.
--      - Support for `delayinit=func`.
--      - Support for `loopchars="chars"`.
--
--  2022/07/30
--      - `hide=true` hides a match.
--      - `opteq=true` affects nested tables.
--
--  2022/07/06
--      - Fixed backward compatibility shim to work on v0.4.9 as well.
--
--  2022/03/22
--      - Initial version.
--------------------------------------------------------------------------------

if not clink then
    -- E.g. some unit test systems will run this module *outside* of Clink.
    return
end

local tmp = clink.argmatcher and clink.argmatcher() or clink.arg.new_parser()
local meta = getmetatable(tmp)
local interop = {}

local function condense_stack_trace(skip_levels)
    local append
    local ret = ""
    local stack = debug.traceback(skip_levels)
    for _,s in string.explode(stack, "\n") do
        s = s:gsub("^ *(.-) *$", "%1")
        if #s > 0 then
            if append then
                ret = ret .. append
            else
                append = " / "
            end
            ret = ret .. s
        end
    end
    return ret
end

local function make_arg_hider_func(...)
    if not clink.onfiltermatches then
        if log and log.info then
            log.info("make_arg_hider_func requires clink.onfiltermatches; "..condense_stack_trace())
        end
        return
    end

    local args = {...}

    local function filter_matches()
        local function onfilter(matches, completion_type, filename_completion_desired)
            local index = {}

            local function add_to_index(tbl)
                for _,add in ipairs(tbl) do
                    if type(add) == "table" then
                        add_to_index(add)
                    elseif type(add) == "function" then
                        add_to_index(add(matches, completion_type, filename_completion_desired))
                    elseif type(add) == "string" then
                        index[add] = true
                    end
                end
            end

            add_to_index(args)

            for j = #matches, 1, -1 do
                local m = matches[j].match
                if index[m] then
                    table.remove(matches, j)
                end
            end

            return matches
        end

        clink.onfiltermatches(onfilter)
        return {}
    end

    return filter_matches
end

if not tmp.addarg then
    interop.addarg = function(parser, ...)
        -- Extra braces to make sure exactly one argument position is added.
        parser:add_arguments({...})
        return parser
    end
end

if not tmp.addflags then
    interop.addflags = function(parser, ...)
        parser:add_flags(...)
        return parser
    end
end

if not tmp.nofiles then
    interop.nofiles = function(parser)
        parser:disable_file_matching()
        return parser
    end
end

if not tmp.adddescriptions then
    interop.adddescriptions = function(parser)
        return parser
    end
end

if not tmp.hideflags then
    interop.hideflags = function(parser)
        return parser
    end
end

if not tmp.setflagsanywhere then
    interop.setflagsanywhere = function(parser)
        return parser
    end
end

if not tmp.setendofflags then
    interop.setendofflags = function(parser)
        return parser
    end
end

if not tmp._addexflags or not tmp._addexarg then
    local link = "link"..tmp
    local meta_link = getmetatable(link)

    local function is_parser(x)
        return getmetatable(x) == meta
    end

    local function is_link(x)
        return getmetatable(x) == meta_link
    end

    local function onarg_hide_unless(arg_index, word, word_index, line_state, user_data) -- luacheck: no unused
        if arg_index == 0 then
            local present = user_data.present
            if not present then
                present = {}
                user_data.present = present
            end
            word = word:gsub("[:=].*$", "")
            present[word] = true
        end
    end

    local function do_filter(matches, conditions, user_data)
        local ret = {}
        local present = user_data.present or {}
        for _,m in ipairs(matches) do
            local test_list = conditions[m.match]
            if test_list then
                local ok
                for _,test in ipairs(test_list) do
                    if present[test] then
                        ok = true
                        break
                    end
                end
                if not ok then
                    goto continue
                end
            end
            table.insert(ret, m)
    ::continue::
        end
        return ret
    end

    local function add_elm(elm, list, descriptions, hide, hide_unless, in_opteq)
        local arg
        local opteq = in_opteq
        if elm[1] then
            arg = elm[1]
        else
            if type(elm) == "table" and not is_link(elm) and not is_parser(elm) then
                return
            end
            arg = elm
        end
        if elm.opteq ~= nil then
            opteq = elm.opteq
        end

        local t = type(arg)
        local arglinked = is_link(arg)
        if arglinked or is_parser(arg) then
            t = "matcher"
        elseif t == "table" then
            if elm[4] then
                t = "nested"
            else
                for _,scan in ipairs(elm) do
                    if type(scan) == "table" then
                        t = "nested"
                        break
                    end
                end
            end
        end
        if t == "string" or t == "number" or t == "matcher" then
            if t == "matcher" then
                table.insert(list, arg)
                if opteq and arglinked and clink.argmatcher then
                    local altkey
                    if arg._key:sub(-1) == '=' then
                        altkey = arg._key:sub(1, #arg._key - 1)
                    else
                        altkey = arg._key..'='
                    end
                    table.insert(hide, altkey)
                    table.insert(list, { altkey..arg._matcher })
                end
            else
                table.insert(list, tostring(arg))
            end
            if elm[2] and descriptions then
                local name = arglinked and arg._key or arg
                if elm[3] then
                    descriptions[name] = { elm[2], elm[3] }
                else
                    descriptions[name] = { elm[2] }
                end
            end
            if elm.hide then
                local name = arglinked and arg._key or arg
                table.insert(hide, name)
            end
            if hide_unless and elm.hide_unless then
                local unless = {}
                for _,u in ipairs(string.explode(elm.hide_unless)) do
                    table.insert(unless, u)
                end
                if unless[1] then
                    hide_unless[arg] = unless
                end
            end
        elseif t == "function" then
            table.insert(list, arg)
        elseif t == "nested" then
            for _,sub_elm in ipairs(elm) do
                add_elm(sub_elm, list, descriptions, hide, hide_unless, opteq)
            end
        else
            pause("unrecognized input table format.")
            error("unrecognized input table format.")
        end
    end

    local function build_lists(tbl, is_flags)
        local list = {}
        local descriptions = (not ARGHELPER_DISABLE_DESCRIPTIONS) and {} -- luacheck: no global
        local hide = {}
        local hide_unless = is_flags and {}
        if type(tbl) ~= "table" then
            pause('table expected.')
            error('table expected.')
        end
        for _,elm in ipairs(tbl) do
            local t = type(elm)
            if t == "table" then
                add_elm(elm, list, descriptions, hide, hide_unless, tbl.opteq)
            elseif t == "string" or t == "number" or t == "function" then
                table.insert(list, elm)
            end
        end
        list.delayinit = tbl.delayinit
        list.fromhistory = tbl.fromhistory
        list.loopchars = tbl.loopchars
        list.nosort = tbl.nosort
        list.onadvance = tbl.onadvance
        list.onlink = tbl.onlink
        list.onarg = tbl.onarg
        if hide_unless then
            local any = false
            for _,_ in pairs(hide_unless) do -- luacheck: ignore 512
                any = true
                break
            end
            if not any then
                hide_unless = nil
            end
        end
        return list, descriptions, hide, hide_unless
    end

    if not tmp._addexflags then
        interop._addexflags = function(parser, tbl)
            local flags, descriptions, hide, hide_unless = build_lists(tbl, true--[[is_flags]])
            if hide_unless then
                if tbl.onarg then
                    local fwd = tbl.onarg
                    flags.onarg = function(arg_index, word, word_index, line_state, user_data)
                        fwd(arg_index, word, word_index, line_state, user_data)
                        onarg_hide_unless(arg_index, word, word_index, line_state, user_data)
                    end
                else
                    flags.onarg = onarg_hide_unless
                end
                table.insert(flags, function (word, word_index, line_state, match_builder, user_data) -- luacheck: no unused, no max line length
                    clink.onfiltermatches(function (matches)
                        return do_filter(matches, hide_unless, user_data)
                    end)
                end)
            end
            parser:addflags(flags)
            if descriptions then
                parser:adddescriptions(descriptions)
            end
            if hide then
                parser:hideflags(hide)
            end
            return parser
        end
    end
    if not tmp._addexarg then
        interop._addexarg = function(parser, tbl)
            local args, descriptions, hide = build_lists(tbl)
            parser:addarg(args, make_arg_hider_func(hide))
            if descriptions then
                parser:adddescriptions(descriptions)
            end
            return parser
        end
    end
end

-- If nothing was missing, then no interop functions got added, and the meta
-- table doesn't need to be modified.
for _,_ in pairs(interop) do -- luacheck: ignore 512
    local old_index = meta.__index
    meta.__index = function(parser, key)
        local value = rawget(interop, key)
        if value then
            return value
        elseif not old_index then
            return rawget(parser, key)
        elseif type(old_index) == "function" then
            return old_index(parser, key)
        elseif old_index == meta then
            return rawget(old_index, key)
        else
            return old_index[key]
        end
    end
    break
end

local exports = {
    make_arg_hider_func = make_arg_hider_func
}

return exports
