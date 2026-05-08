require("arghelper")
local mcf = require("multicharflags")
local clink_version = require("clink_version")

--------------------------------------------------------------------------------
-- General helper functions.

local function __get_delimiter_after(line_state, word_index)
    local s
    local x = line_state:getwordinfo(word_index)
    if x then
        local y = line_state:getwordinfo(word_index + 1)
        if y then
            local line = line_state:getline()
            s = line:sub(x.offset + x.length, y.offset - 1)
        end
    end
    return s or ""
end

local fromcodepage
if unicode and unicode.fromcodepage then
    fromcodepage = unicode.fromcodepage
else
    fromcodepage = function(text) return text end
end

local function __parse_descriptions(argmatcher, command, descriptions, is_arg_func, parse_arg_choices)
    local f = io.popen("2>nul "..command.." /?")
    if f then
        local pending = {}
        local seen = {}

        local function finish_pending()
            if pending.flag and pending.desc then
                local desc = pending.desc
                    :gsub("^%s+", "")
                    :gsub("(%.%s.*)$", "")
                    :gsub("%.$", "")
                    :gsub("%s+$", "")
                local t = descriptions[pending.flag]
                if t then
                    if pending.arginfo then
                        t[1] = pending.arginfo
                    end
                    table.insert(t, desc)
                end
                if pending.choices then
                    local am = mcf.addcharflagsarg(clink.argmatcher(), pending.choices)
                    argmatcher:addflags({ (pending.flag..":")..am, (pending.flag:upper()..":")..am })
                end
            end
            pending.flag = nil
            pending.arginfo = nil
            pending.choices = nil
            pending.desc = nil
        end

        local sort_quirks = command:find("sort")
        for line in f:lines() do
            line = line:gsub("[\r\n]+$", "")
            line = fromcodepage(line)
            local flag, arginfo, text
            text = line:match("^%s%s%s%s%s%s%s%s%s%s%s%s+([^%s].*)$")
            if not text then
                flag, text = line:match("^%s%s+(/?[A-Za-z0-9]+)%s+([^%s].*)$")
                if sort_quirks and not flag then
                    -- E.g. "  /+n " or "  /REC["
                    flag = line:match("^%s%s+(/[+A-Za-z]+)[%[ ]")
                    if flag then
                        if flag:find("^/%+") then
                            -- E.g. "  /+n                         Specifies blah blah"
                            flag = "/+"
                            arginfo = flag:match("^/%+(.+)$")
                        end
                        text = line:match("^%s%s+/[+A-Za-z_0-9%[%]]+%s%s+([^ ].+)$")
                        if not text then
                            -- E.g. "  /L[OCALE] locale            Specifies blah blah"
                            arginfo, text = line:match("^%s%s+/[+A-Za-z_0-9%[%]]+%s([^ ]+)%s+([^ ].+)$")
                            if arginfo then
                                arginfo = " "..arginfo
                            end
                        end
                    else
                        -- E.g. "    [drive2:][path2]          Specifies blah blah"
                        arginfo, text = line:match("^%s%s+(%[[^ ]+)%s+([^ ].*)$")
                        if arginfo then
                            arginfo = arginfo:gsub("[1-3](:?)%]", "%1]"):gsub("[1-3]$", "")
                            pending.arginfo = " "..arginfo
                        end
                    end
                end
            end

            if flag and is_arg_func then
                if is_arg_func(flag, pending) then
                    pending.choices = { caseless=true }
                    flag = nil
                end
            end

            if flag then
                finish_pending()
                flag = "/"..flag:gsub("^/+", ""):lower()
                if not seen[flag] and descriptions[flag] then
                    seen[flag] = true
                    pending.flag = flag
                    pending.arginfo = arginfo
                    pending.choices = nil
                    pending.desc = text or ""
                end
            elseif not text then
                finish_pending()
            elseif pending.choices then
                parse_arg_choices(pending.choices, text)
            elseif pending.desc then
                pending.desc = pending.desc.." "..text
            end
        end

        finish_pending()
        f:close()
    end
end

--------------------------------------------------------------------------------
-- DIR

if clink_version.supports_argmatcher_delayinit then

local accepted_chars_list = {}
accepted_chars_list["/a"] = "^[-dhslraio]"
accepted_chars_list["/o"] = "^[-negsd]"
accepted_chars_list["/t"] = "^[acw]"

local function dir__classifier(arg_index, word, word_index, line_state, classifications)
    if arg_index == 0 then
        local flag = word:match("(/[aAoOtT])[^:]")
        if flag then
            local info = line_state:getwordinfo(word_index)
            local flag_color = settings.get("color.flag")
            local arg_color = settings.get("color.arg")
            local bad_color = settings.get("color.unrecognized") or "91"
            if flag_color then
                classifications:applycolor(info.offset, 2, flag_color)
            end
            local okpat = accepted_chars_list[flag:lower()]
            for i = 3, #word do
                local color
                if word:find(okpat, i) then
                    color = arg_color
                else
                    color = bad_color
                end
                if color then
                    classifications:applycolor(info.offset + i - 1, 1, color)
                end
            end
            return true
        end
    end
end

local function dir__delayinit(argmatcher)
    argmatcher:setdelayinit(nil)

    local descriptions = {
    ["/a"]           = { "attributes" },
    ["/b"]           = {},
    ["/c"]           = {},
    ["/c-"]          = { "Disable display of thousand separator in file sizes" },
    ["/d"]           = {},
    ["/l"]           = {},
    ["/n"]           = {},
    ["/o"]           = { "sortorder" },
    ["/p"]           = {},
    ["/q"]           = {},
    ["/r"]           = {},
    ["/s"]           = {},
    ["/t"]           = { "timefield" },
    ["/w"]           = {},
    ["/x"]           = {},
    ["/4"]           = {},
    }

    local function is_arg_func(_, pending)
        if pending.flag == "/a" or pending.flag == "/o" or pending.flag == "/t" then
            return not pending.choices
        end
    end

    local colpat = "([^%s])%s%s+([^%s].+)"
    local function parse_arg_choices(choices, text)
        if text:find("  .*  ") then
            -- Two columns.
            local ltr1, desc1, ltr2, desc2 = text:match("^"..colpat.."%s%s+"..colpat.."$")
            if ltr1 then
                desc1 = desc1:gsub("%s+$", "")
                desc2 = desc2:gsub("%s+$", "")
                table.insert(choices, { ltr1:lower(), desc1 })
                table.insert(choices, { ltr2:lower(), desc2 })
            end
        else
            -- One column.
            local ltr, desc = text:match("^"..colpat.."$")
            if ltr then
                desc = desc:gsub("%s+$", "")
                table.insert(choices, { ltr:lower(), desc })
            end
        end
    end

    local dir__upper_case_flags = {
        "/A",
        "/B", "/C", "/C-", "/D", "/L", "/N",
        "/O",
        "/P", "/Q", "/R", "/S",
        "/T",
        "/W", "/X",
    }

    argmatcher:addflags({
        "/?",
        "/a",
        "/A",
        "/b", "/c", "/c-", "/d", "/l", "/n",
        "/o",
        "/O",
        "/p", "/q", "/r", "/s",
        "/t",
        "/T",
        "/w", "/x",
        dir__upper_case_flags,
        "/4",
    })

    __parse_descriptions(argmatcher, "dir", descriptions, is_arg_func, parse_arg_choices)

    for _,f in ipairs({"/a", "/o", "/t"}) do
        if #descriptions[f] < 2 then
            table.insert(descriptions[f], "")
        end
    end

    descriptions["/a:"] = descriptions["/a"]
    descriptions["/o:"] = descriptions["/o"]
    descriptions["/t:"] = descriptions["/t"]
    descriptions["/o"] = descriptions["/o"][2]

    argmatcher
    :adddescriptions(descriptions)
    :hideflags("/?", dir__upper_case_flags, "/a", "/t", "/A:", "/O:", "/T:")
    :setclassifier(dir__classifier)
end

clink.argmatcher("dir")
:setdelayinit(dir__delayinit)
:setcmdcommand()

end -- Version check.

--------------------------------------------------------------------------------
-- FOR
--
-- This argmatcher for the FOR command requires Clink v1.5.14 or higher.
-- It handles the syntax quirks:
--      - At most one flag may be used.
--      - The /r and /f flags have optional arguments.
--      - The /f "options" allows multiple keywords in a single quoted string.
--      - The (...) set must be surrounded by parentheses.

if clink_version.supports_argmatcher_onlink then

local function for__is_flag(word)
    local flag = word:match("^/[dDrRlLfF?]$")
    if flag then
        return flag:lower()
    end
end

local function for__get_full_word(line_state, word_index, reject_quoted)
    local info = line_state:getwordinfo(word_index)
    if info and (not reject_quoted or not info.quoted) then
        local line = line_state:getline()
        local st = info.offset
        local en = info.offset + info.length
        if st > 1 then
            st = st - 1
        end
        local word = line:sub(st, en):gsub("^ +", ""):gsub(" +$", "")
        return word
    end
end

local function for__onadvance_flag(_, word, word_index, line_state, user_data)
    local flag = for__is_flag(word)
    if not flag then
        if word_index < line_state:getwordcount() then
            return 1            -- Ignore this arg_index.
        elseif word ~= "/" then
            return 1            -- Ignore this arg_index.
        end
    end
    user_data.flag = flag
end

-- luacheck: push
-- luacheck: no max line length
local for__option_matches = {
    { match="/d",                           description="Match (set) against directories" },
    { match="/r",  arginfo=" [dir]",        description="Walk dir recursively, executing the FOR command in each directory" },
    { match="/l",                           description="The set is a sequence of numbers (start,step,end)" },
    { match="/f",  arginfo=' ["options"]',  description="File processing; each file in the set is read and processed" },
}
-- luacheck: pop

local function for__display_options()
    clink.onfiltermatches(function ()
        return { "/d", "/r", "/l", "/f" }
    end)
    return for__option_matches
end

local function for__onadvance_dir(_, word, _, _, user_data)
    if user_data.flag ~= "/r" or word:find("^%%") then
        return 1                -- Ignore this arg_index.
    end
end

local function for__onadvance_options(_, word, word_index, line_state, user_data)
    if user_data.flag ~= "/f" or word:find("^%%") then
        return 1                -- Ignore this arg_index.
    end
    local info = line_state:getwordinfo(word_index)
    if not info or not info.quoted then
        return 1                -- Ignore this arg_index.
    end
end

local function for__init_in_arg_builder(_, _, _, builder, _)
    clink.onfiltermatches(function ()
        return { "in \x28" }
    end)
    builder:setsuppressappend()
    builder:setsuppressquoting()
    return {}
end

local for__lower_case_vars = {
    "%a", "%b", "%c", "%d", "%e", "%f", "%g", "%h", "%i", "%j", "%k", "%l", "%m",
    "%n", "%o", "%p", "%q", "%r", "%s", "%t", "%u", "%v", "%w", "%x", "%y", "%z",
}
local for__upper_case_vars = {
    "%A", "%B", "%C", "%D", "%E", "%F", "%G", "%H", "%I", "%J", "%K", "%L", "%M",
    "%N", "%O", "%P", "%Q", "%R", "%S", "%T", "%U", "%V", "%W", "%X", "%Y", "%Z",
}

--[[
local function for__filter_vars()
    clink.onfiltermatches(function ()
        return for__lower_case_vars
    end)
    return {}
end
--]]

local function for__repeat_unless_close_paren(_, _, word_index, line_state, _)
    local after = __get_delimiter_after(line_state, word_index)
    if not after:find("%)") then
        return 0                -- Repeat this arg_index.
    end
end

local for__color_options = {}
for__color_options["eol="] = true
for__color_options["skip="] = true
for__color_options["delims="] = true
for__color_options["tokens="] = true
for__color_options["usebackq"] = true

local function for__classifier(arg_index, word, word_index, line_state, classifications)
    local zap, zapafter

    if arg_index == 1 then
        classifications:classifyword(word_index, "f")
        return true
    elseif arg_index == 3 then
        local info = line_state:getwordinfo(word_index)
        zap = not info.quoted and #word > 0
        if not zap then
            local arg_color
            local line = line_state:getline()
            word = line:sub(info.offset, info.offset + info.length - 1)
            if #word then
                local trailing
                local start
                local text = ""
                local j = 0
                local iter = unicode.iter(word)
                while true do
                    local s = iter()
                    local apply
                    if s == " " or not s then
                        apply = (text == "usebackq")
                        trailing = nil
                        if s and not apply then
                            start = nil
                            text = ""
                        end
                    elseif not trailing then
                        start = start or j
                        text = text..s
                        if s == "=" then
                            trailing = true
                            apply = for__color_options[text]
                        end
                    end
                    if apply then
                        if not arg_color then
                            arg_color = settings.get("color.arg")
                        end
                        classifications:applycolor(info.offset + start, #text, arg_color)
                        start = nil
                        text = ""
                    end
                    if not s then
                        break
                    end
                    j = j + #s
                end
            end
        end
    elseif arg_index == 4 then
        word = for__get_full_word(line_state, word_index, true)
        if not word or not word:find("^%%") then
            zap = true
        elseif #word > 2 then
            zap = true
        elseif #word == 2 then
            zap = not word:match("^%%[a-zA-Z]$")
        end
    elseif arg_index == 5 then
        word = word:lower()
        zap = (word ~= "i" and word ~= "in")
        if not zap and word_index < line_state:getwordcount() then
            local after = __get_delimiter_after(line_state, word_index)
            zap = not after:find("%s+%(")
            zapafter = zap
        end
    elseif arg_index == 7 then
        word = word:lower()
        zap = (word ~= "d" and word ~= "do")
    end

    if zap then
        local color = settings.get("color.unexpected") or ""
        local wordinfo = line_state:getwordinfo(word_index)
        local lastinfo = line_state:getwordinfo(line_state:getwordcount())
        local endoffset = lastinfo.offset + lastinfo.length
        local tailoffset = wordinfo.offset
        if zapafter then
            tailoffset = tailoffset + wordinfo.length
        elseif wordinfo.quoted then
            tailoffset = tailoffset - 1
        end
        if endoffset > tailoffset then
            local line = line_state:getline()
            local tail = line:sub(endoffset):match("^([^&|]+)[&|]?.*$") or ""
            endoffset = endoffset + #tail
        end
        classifications:applycolor(tailoffset, endoffset - tailoffset, color)
        return true
    end
end

clink.argmatcher("for")
:addarg({
    onadvance=for__onadvance_flag,
    for__display_options,
    "/d", "/r", "/l", "/f",
    "/D", "/R", "/L", "/F",
    "/?",
})
:addarg({
    onadvance=for__onadvance_dir,
    clink.dirmatches,
})
:addarg({
    onadvance=for__onadvance_options,
    -- This has to use a generator to produce completions, since there can be
    -- multiple options in the quoted string.
})
:addarg({
    --for__filter_vars,
    for__lower_case_vars,
    for__upper_case_vars,
})
:addarg({
    "in",
    "in \x28",
    for__init_in_arg_builder,
})
:addarg({
    onadvance=for__repeat_unless_close_paren,
    clink.filematches,
})
:addarg("do"..clink.argmatcher():chaincommand())
:nofiles()
:setclassifier(for__classifier)
:setcmdcommand()

local function for__is_f_options(line_state, only_endword)
    local cwi = line_state:getcommandwordindex()
    local count = line_state:getwordcount()
    if line_state:getword(cwi):lower() == "for" and
            line_state:getword(cwi + 1):lower() == "/f" then
        local sinfo = line_state:getwordinfo(cwi + 2)
        if sinfo and sinfo.quoted then
            if only_endword and cwi + 2 < count then
                local einfo = line_state:getwordinfo(count)
                local s = line_state:getline():sub(sinfo.offset, einfo.offset + einfo.length - 1)
                if s:find('"') then
                    return
                end
            end
            local sq = (cwi + 2 == count and 2) or 1
            return cwi + 2, sq
        end
    end
end

local for__generator = clink.generator(20)
function for__generator:generate(line_state, builder) -- luacheck: no unused
    local is, sq = for__is_f_options(line_state, true)
    if is then
        builder:setsuppressquoting(sq)
        builder:setsuppressappend()
        builder:setnosort()
        builder:addmatches({
            -- luacheck: push
            -- luacheck: no max line length
            { match="eol=", arginfo="c",            description="Specifies an end of line comment character (just one)" },
            { match="skip=", arginfo="n",           description="Specifies the number of lines to skip at the beginning of the file" },
            { match="delims=", arginfo="xxx",       description="Specifies a delimiter set (default is space and tab)" },
            { match="tokens=", arginfo="x,y,m-n",   description="Specifies which tokens from each line go in the %a variables" },
            { match="usebackq ",                    description="Uses new semantics (back quote executes as a command)" },
            -- luacheck: pop
        })
        return true
    end
end
function for__generator:getwordbreakinfo(line_state) -- luacheck: no unused
    if for__is_f_options(line_state) then
        local word = line_state:getendword()
        local last_space = word:find(" [^ ]*$")
        if last_space then
            return last_space, 0
        end
    end
end

end -- Version check.

--------------------------------------------------------------------------------
-- SORT.EXE
--
-- This includes the /UNIQ[UE] flag on Windows 10 and later, even though it is
-- missing from the help text.

if clink_version.supports_argmatcher_onlink then

local function get_sort_exe()
    return path.join(os.getenv("SystemRoot"), "System32\\sort.exe")
end

local _win10
local function is_win10()
    if _win10 == nil then
        _win10 = false
        local f = io.popen("ver")
        if f then
            for line in f:lines() do
                local major = line:match(" ([0-9]+)%.[0-9]+%.[0-9]+%.[0-9]+")
                if major then
                    _win10 = (tonumber(major) >= 10)
                    break
                end
            end
            f:close()
        end
    end
    return _win10
end

local function sort__is_slashplus(arg_index, word, word_index, line_state)
    if arg_index == 0 and word == "/" then
        local info = line_state:getwordinfo(word_index)
        local char_index = info.offset + info.length
        if line_state:getline():sub(char_index, char_index) == "+" then
            return info.offset, 2
        end
    end
end

local sort__slashplus_parser = clink.argmatcher():addarg({fromhistory=true})
local function slashplus_link(_, arg_index, word, word_index, line_state)
    if sort__is_slashplus(arg_index, word, word_index, line_state) then
        return sort__slashplus_parser
    end
end

local function slashplus_quirks(_, _, _, builder)
    builder:setsuppressquoting()
    return {}
end

local function sort__classifier(arg_index, word, word_index, line_state, classifications)
    local offset, len = sort__is_slashplus(arg_index, word, word_index, line_state)
    if offset then
        local color = settings.get("color.flag")
        classifications:applycolor(offset, len, color)
    end
end

local function sort__delayinit(argmatcher)
    argmatcher:setdelayinit(nil)

    local descriptions = {
    ["/+"]      = { "n" },
    ["/l"]      = { " locale" },
    ["/m"]      = { " kilobytes" },
    ["/rec"]    = { " characters" },
    ["/r"]      = {},
    ["/t"]      = { " [drive:][path]" },
    ["/o"]      = { " [drive:][path]" },
    ["/uniq"]   = {},
    }

    __parse_descriptions(argmatcher, get_sort_exe(), descriptions)

    if #descriptions["/r"] > 1 then
        table.remove(descriptions["/r"], 1)
    end
    if #descriptions["/uniq"] < 1 then
        table.insert(descriptions["/uniq"], "Discard all but one of identical lines")
    end
    for _, flag in ipairs({"/+", "/l", "/m", "/rec", "/t", "/o"}) do
        if #descriptions[flag] < 2 then
            table.insert(descriptions[flag], "")
        end
    end

    local locale_matches = { { match="C", description="The fastest collating sequence" } }

    local locales_parser = clink.argmatcher():addarg({locale_matches, "C"})
    local memory_parser = clink.argmatcher():addarg({fromhistory=true})
    local record_maximum_parser = clink.argmatcher():addarg({fromhistory=true})
    local dirs = clink.argmatcher():addarg(clink.dirmatches)
    local files = clink.argmatcher():addarg(clink.filematches)

    local desc_slpl = descriptions["/+"]
    local flags_list = {
        nosort=true,
        onlink=slashplus_link,
        slashplus_quirks,
        "/?",
        { match="/+", arginfo=desc_slpl[1], description=desc_slpl[2], type="flag", suppressappend=true },
        "/l"..locales_parser,           "/locale"..locales_parser,
        "/L"..locales_parser,           "/LOCALE"..locales_parser,
        "/m"..memory_parser,            "/memory"..memory_parser,
        "/M"..memory_parser,            "/MEMORY"..memory_parser,
        "/rec"..record_maximum_parser,  "/record_maximum"..record_maximum_parser,
        "/REC"..record_maximum_parser,  "/RECORD_MAXIMUM"..record_maximum_parser,
        "/r",                           "/reverse",
        "/R",                           "/REVERSE",
        "/t"..dirs,                     "/temporary"..dirs,
        "/T"..dirs,                     "/TEMPORARY"..dirs,
        "/o"..files,                    "/output"..files,
        "/O"..files,                    "/OUTPUT"..files,
    }

    if not is_win10() then
        descriptions["/uniq"] = nil
    else
        table.insert(flags_list, "/uniq")
        table.insert(flags_list, "/UNIQ")
        table.insert(flags_list, "/unique")
        table.insert(flags_list, "/UNIQUE")
    end

    argmatcher
    :addarg(clink.filematches)
    :addflags(flags_list)
    :adddescriptions(descriptions)
    :hideflags({
        "/?",
        "/locale", "/memory", "/record_maximum", "/reverse", "/temporary", "/output", "/unique",
        "/L", "/M", "/REC", "/R", "/T", "/O", "/UNIQ",
        "/LOCALE", "/MEMORY", "/RECORD_MAXIMUM", "/REVERSE", "/TEMPORARY", "/OUTPUT", "/UNIQUE",
    })
    :setclassifier(sort__classifier)
end

clink.argmatcher(get_sort_exe()):setdelayinit(sort__delayinit)

end -- Version check.

--------------------------------------------------------------------------------
-- START
--
-- This argmatcher for the START command requires Clink v1.5.14 or higher.
-- It handles the fact that a quoted title is optional.

if clink_version.supports_argmatcher_onlink then

local start__generating

local start__generator = clink.generator(1)
function start__generator:generate() -- luacheck: no unused
    start__generating = true
end

local start__resetclassifier = clink.classifier(1)
function start__resetclassifier:classify() -- luacheck: no unused
    start__generating = false
end

local isdir_cache = {}
local isdir_order = {}

clink.onbeginedit(function()
    isdir_cache = {}
    isdir_order = {}
end)

local function isdir_with_caching(name)
    -- Filter out weird case.
    if name:find("/") and not name:find("\\") then
        return
    end

    -- Async check whether it's an executable.
    local r, ready = clink.recognizecommand(name)
    if not ready then
        return
    end
    if r == "x" then
        return
    end

    -- Not an executable, so check if it's a dir.  This is to accurately
    -- indicate what "start {dir}" will do.  The result is cached for optimal
    -- performance.
    local expanded = os.expandenv(name)
    local isdir = isdir_cache[expanded]
    if isdir == nil then
        isdir = os.isdir(expanded) and true or false
        isdir_cache[expanded] = isdir
        table.insert(isdir_order, 1, expanded)
        local num = #isdir_order
        while num > 10 do
            table.remove(isdir_order, num)
            num = num - 1
        end
    end

    return isdir
end

local function start__maybe_title(_, _, word_index, line_state, user_data)
    local info = line_state:getwordinfo(word_index)
    if not info.quoted then
        return 1    -- Advance; this arg position only accepts a quoted string.
                    -- Anything else should get handled by the next position.
    end
    user_data.hastitle = true
end

local function start__maybe_dir(_, word, word_index, line_state, user_data)
    if user_data.hastitle or not isdir_with_caching(word) then
        -- Not a dir, so chain to a new command.
        return 1
    end
    if word_index < line_state:getwordcount() then
        -- It's a directory and there are more words.  Let this arg index handle
        -- the arg (coloring it as generic input), and set a flag to link to a
        -- nofiles parser to block further parsing.
        user_data.isdir = true
    elseif start__generating then
        -- This is the last word and the context is match generation (not
        -- classifying), so chain to a new command for generating matches.
        return 1
    end
end

local function start__classifier(arg_index, _, word_index, _, classifications)
    if arg_index == 2 then
        classifications:classifyword(word_index, "a")
    end
end

local start__deadend = clink.argmatcher():nofiles()
local function start__maybe_link(_, _, _, _, _, user_data)
    if user_data.isdir then
        return start__deadend
    end
end

local function start__delayinit(argmatcher)
    argmatcher:setdelayinit(nil)

    local descriptions = {
    ["/d"]           = { " dir" },
    ["/b"]           = {},
    ["/i"]           = {},
    ["/min"]         = {},
    ["/max"]         = {},
    ["/separate"]    = {},
    ["/shared"]      = {},
    ["/low"]         = {},
    ["/normal"]      = {},
    ["/high"]        = {},
    ["/realtime"]    = {},
    ["/abovenormal"] = {},
    ["/belownormal"] = {},
    ["/node"]        = { " node" },
    ["/affinity"]    = { " hexmask" },
    ["/wait"]        = {},
    }

    __parse_descriptions(argmatcher, "start", descriptions)

    if #descriptions["/d"] < 2 then
        table.insert(descriptions["/d"], "Starting directory")
    end

    argmatcher
    :addarg({
        onadvance=start__maybe_title,
        fromhistory=true,
    })
    :addarg({
        onadvance=start__maybe_dir,
        onlink=start__maybe_link,
    })
    :addflags({
        nosort=true,
        "/?",
        "/d"..clink.argmatcher():addarg(clink.dirmatches),
        "/b", "/i",
        "/min", "/max", "/wait",
        "/separate", "/shared",
        "/low", "/normal", "/high", "/realtime", "/abovenormal", "/belownormal",
        "/node"..clink.argmatcher():addarg({fromhistory=true}),
        "/affinity"..clink.argmatcher():addarg({fromhistory=true}),
    })
    :adddescriptions(descriptions)
    :hideflags("/?")
    :chaincommand("start")
    :setclassifier(start__classifier)
end

clink.argmatcher("start")
:setdelayinit(start__delayinit)
:setcmdcommand()

end -- Version check.

