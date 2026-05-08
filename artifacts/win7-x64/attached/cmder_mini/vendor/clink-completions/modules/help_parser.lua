--------------------------------------------------------------------------------
-- This exports a table containing functions that delayinit argmatchers can use
-- to parse help text output from programs.
--
--      local help_parser = require('help_parser')
--
--      help_parser.run(argmatcher, 'gnu', 'grep --help')
--      help_parser.run(argmatcher, 'basic', 'findstr /?', { slashes=true })
--
--      help_parser.make('curl "--help all" curl')
--      help_parser.make('xcopy /?')
--
--  function run(argmatcher, parser, command, config)
--
--      Runs parser on the command output to initialize argmatcher.
--
--      argmatcher  The argmatcher to be initialized.
--      parser      Can be a parser function, or the name of a built-in parser.
--                  Built-in parsers are: 'basic', 'curl', 'gnu'.
--      command     The command whose output to parse as help text, OR a table
--                  of lines of help text output to be parsed.
--      config      Optional table with configuration modes.
--                  {
--                      case=nil,       -- Smart case; add lower case flags if
--                                      -- all flags are upper case.
--                      case=1,         -- Force adding lower case copies of
--                                      -- flags.
--                      case=2,         -- Add flags with verbatim casing.
--                      slashes=true,   -- Add slash copies of minus flags
--                                      -- (add /x for -x, etc).
--                  }
--
--  function make(command, help_flag, parser, config, closure)
--
--      Makes a delayinit argmatcher for the command.  A completion script can
--      be a single line, using this:
--
--          require('help_parser').make('xcopy', '/?')
--
--      command     Command for which to make an argmatcher.
--      help_flag   The command line args to append to get the help text for
--                  parsing into an argmatcher.
--      parser      Optional parser to use (see run()).
--      config      Optional table with configuration modes (see run()).
--      closure     Optional function to call on completion of the argmatcher,
--                  called as closure(argmatcher).
--
--
-- Parser functions:
--
--  function parser(context, flags, descriptions, hideflags, line)
--
--      context         A container table for use by the parser function.
--      flags           Use add_pending() to update flags.
--      descriptions    Use add_pending() to update descriptions.
--      hideflags       A table of flag names to hide (table of strings).
--      line            The help text line to be parsed.
--
--  function add_pending(context, flags, descriptions, hideflags, pending)
--
--      context         Pass the context table from the parser() function.
--      flags           Pass the flags table from the parser() function.
--      descriptions    Pass the descriptions table from the parser() function.
--      hideflags       Pass the hideflags table from the parser() function.
--      pending         The flag(s) to add.  Scheme:
--                      {
--                          flag="-x",          -- Flag to add.
--                          has_arg=true,       -- Whether the flag has an arg.
--                          display=" file",    -- Arg info label to show.
--                          desc="Description text.",   -- Description.
--                      }

--------------------------------------------------------------------------------
-- NOTE:  This script can be run as a standalone script for debugging purposes:
--
-- The following usage:
--
--      clink lua help_parser {parser_name} {command_line}
--
-- Prints the results of:
--
--      local help_parser = require('help_parser')
--      help_parser.run(argmatcher, 'parser_name', 'command_line')

--------------------------------------------------------------------------------
if not clink then
    -- E.g. some unit test systems will run this module *outside* of Clink.
    return
end
if (clink.version_encoded or 0) < 10030010 then -- Requires _argmatcher:setdelayinit().
    if log and log.info then
        log.info('The help_parser.lua module requires a newer version of Clink; please upgrade.')
    end
    return
end

--------------------------------------------------------------------------------
local function sentence_casing(text)
    if unicode.iter then -- luacheck: no global
        for str in unicode.iter(text) do -- luacheck: ignore 512, no global
            return clink.upper(str) .. text:sub(#str + 1)
        end
        return text
    else
        return clink.upper(text:sub(1,1)) .. text:sub(2)
    end
end

--------------------------------------------------------------------------------
local _file_keywords = { 'file', 'files', 'filename', 'filenames', 'glob' }
local _dir_keywords = { 'dir', 'dirs', 'directory', 'directories', 'path', 'paths' }

for _, k in ipairs(_file_keywords) do
    _file_keywords[' <' .. k .. '>'] = true
    _file_keywords['<' .. k .. '>'] = true
    _file_keywords[' ' .. k] = true
    _file_keywords[k] = true
    _file_keywords[' ' .. k:upper()] = true
    _file_keywords[k:upper()] = true
end

for _, k in ipairs(_dir_keywords) do
    _dir_keywords[' <' .. k .. '>'] = true
    _dir_keywords['<' .. k .. '>'] = true
    _dir_keywords[' ' .. k] = true
    _dir_keywords[k] = true
    _dir_keywords[' ' .. k:upper()] = true
    _dir_keywords[k:upper()] = true
end

local function is_file_arg(display)
    return _file_keywords[display] or display:find('file')
end

local function is_dir_arg(display)
    return _dir_keywords[display]
end

--------------------------------------------------------------------------------
local function add_pending(context, flags, descriptions, hideflags, pending) -- luacheck: no unused args
    if not pending.flag then
        return
    end

    if pending.has_arg and pending.display then
        if not pending.argmatcher then
            if not pending.flag:match('[:=]$') and not pending.display:match('^[ \t]') then -- luacheck: ignore 542
                -- -x<n> or -x[n] or -Tn or etc.  Argmatchers must be separated
                -- from flag by : or = or space.  So, no argmatcher.
                --TODO: The onadvance and onlink callbacks make this possible.
            else
                local args = clink.argmatcher()
                if is_file_arg(pending.display) then
                    args:addarg(clink.filematches)
                elseif is_dir_arg(pending.display) then
                    args:addarg(clink.dirmatches)
                else
                    args:addarg({fromhistory=true})
                end
                pending.argmatcher = args
            end
        end
        pending.args = pending.argmatcher
    else
        pending.args = nil
    end

    table.insert(flags, { flag=pending.flag, args=pending.args })

    pending.desc = (pending.desc or ''):gsub('%.+$', '')
    if pending.display then
        descriptions[pending.flag] = { pending.display, pending.desc }
    else
        descriptions[pending.flag] = { pending.desc }
    end
end

--------------------------------------------------------------------------------
local function earlier_gap(a, b)
    local r
    if not a or not a.ofs then
        r = b
    elseif not b or not b.ofs then
        r = a
    elseif a.ofs <= b.ofs then
        r = a
    else
        r = b
    end
    return r and r.ofs and r or nil
end

--------------------------------------------------------------------------------
local function find_flag_gap(line, allow_no_gap)
    local colon  = { len=3, ofs=line:find(' : ') }
    local spaces = { len=2, ofs=line:find('  ') }
    local tab    = { len=1, ofs=line:find('\t') }

    local gap = earlier_gap(earlier_gap(colon, spaces), tab)
    if gap then
        return gap
    end

    local space  = { len=1, ofs=line:find(' ') }
    if not space.ofs then
        if allow_no_gap then
            return { len=0, ofs=#line + 1 }
        else
            return
        end
    end

    if not line:find('[ \t][-/][^ \t/]', space.ofs) then
        return space
    end
end

--------------------------------------------------------------------------------
-- The basic parser recognizes lines like:
--
--      /A          Description of /A.
--      -A          Description of -A.
--      --foo       Description of --foo.
--      -x file     Description of -x with file argument.
--
-- It strips bracketed stuff like /OFF[LINE].
-- It ignores /nnn, /nnnn, -nnn, and -nnnn.
--
-- Recognizes many variations of file and dir arg types.
-- Other arg types use fromhistory=true.
--
local function basic_parser(context, flags, descriptions, hideflags, line)
    local indent,f = line:match('^([ \t]*)([-/].+)$')
    local pad,d
    if f then
        local gap = find_flag_gap(f, true--[[allow_no_gap]])
        if gap then
            d = f:sub(gap.ofs + gap.len):gsub('^[ \t]+', '')
            f = f:sub(1, gap.ofs - 1):gsub('[ \t]+$', '')
            pad = line:sub(#indent + #f + 1, #line - #d)
        else
            f = nil
        end
    end
    if not f and context.pending.desc then
        indent,d = line:match('^([ \t]+)([^ \t].*)$')
        if indent then
            if #context.pending.desc == 0 then
                context.pending.indent = #indent
            elseif #indent ~= context.pending.indent then
                indent = nil
                d = nil
            end
            if d then
                if #context.pending.desc > 0 then
                    context.pending.desc = context.pending.desc .. ' '
                end
                context.pending.desc = context.pending.desc .. d:gsub('[ \t]+$', '')
            end
        end
    end

    -- Too much indent can't be a flag.
    if indent and #indent > 8 then
        f = nil
    end

    -- Add pending flag.
    if context.pending.flag and (f or not d) then
        if not context.pending.display then
            local display = context.pending.flag:match('^[-/][A-Z].*([cnx]+)$')
            if display then
                context.pending.display = context.pending.flag:sub(0 - #display)
                context.pending.flag = context.pending.flag:sub(1, #context.pending.flag - #display)
            end
        end
        add_pending(context, flags, descriptions, hideflags, context.pending)
        context.pending = {}
    end

    if f then
        -- Skip various things.
        f = f:gsub('[ \t]+$', '')
        local pd = f:match('(%[n%])$')
        if not pd then
            f = f:gsub('%[.*%]$', '')
        end
        d = d:gsub('[ \t]+$', '')

        -- Set pending flag.
        local x, y = f:match('^([^ \t]+)([ \t].+)$')
        if x then
            f = x
            context.pending.display = y
        else
            local delim = f:find('[:=]')
            local bracket = f:find('%[')
            if delim and (not bracket or delim < bracket) then
                x, y = f:match('^([^ \t]+[:=])(.+)$')
            elseif bracket and (not delim or bracket < delim) then
                x, y = f:match('^([^%[]+)(%[.+)$')
            end
            if x then
                f = x
                context.pending.display = y
            end
        end

        if f:match('^[-/]nnnn?$') or f:match('^//') then
            return
        end

        context.pending.flag = f
        context.pending.desc = sentence_casing(d)
        context.pending.indent = #indent + #f + #pad
        context.pending.has_arg = context.pending.display and true
    end
end

--------------------------------------------------------------------------------
-- The curl parser recognizes this layout:
--
--      ... ignore lines unless they start with at least 1 space ...
--       -a, --aardvark <arg>  description
--           --bumblebee <arg>  description
--
-- Arguments are indicated by angle brackets and apply to all of the flags
-- listed on the line of help text.
--
--       -a, --aardvark <arg>  description
--
-- Recognizes many variations of file, and dir arg types.
-- Other arg types use fromhistory=true.
--
local function curl_parser(context, flags, descriptions, hideflags, line)
    -- Parse if the line declares one or more flags.
    local s = line:match('^ +(%-.+)$')
    if not s then
        return
    end

    -- Look for gap between flags and description.
    local gap = find_flag_gap(s)
    if not gap then
        return
    end

    local pending = {}

    -- Parse description.
    pending.desc = s:sub(gap.ofs + gap.len):match('^ *([^ ].*)$')
    if not pending.desc then
        return
    end
    s = s:sub(1, gap.ofs - 1):gsub(' +$', '')
    pending.desc = pending.desc:gsub('%.+$', '')
    pending.desc = pending.desc:gsub('^: ', '')
    pending.desc = sentence_casing(pending.desc)

    -- Parse flag arguments.
    pending.display = s:match(' <.+>$')
    if pending.display then
        s = s:sub(1, #s - #pending.display)
        pending.has_arg = true
    end

    -- Add flags.
    local list = string.explode(s, ',')
    for _,f in ipairs(list) do
        f = f:match('^ *([^ ].*)$')
        if f then
            pending.flag = f
            add_pending(context, flags, descriptions, hideflags, pending)
        end
    end
end

--------------------------------------------------------------------------------
-- The GNU parser recognizes this layout:
--
--      ... ignore lines unless they start with at least 2 spaces ...
--        -a...         description which could be
--                      more than one line
--        -a...
--                      description which could be
--                      more than one line
--
-- Some lines define more than one flag, delimited by commas:
--
--        -b, --bar, etc  description
--        -b, --bar, etc ...
--                      description
--
-- Some flags accept arguments, and follow these layouts:
--
--        --abc[=X]     Defines --abc and --abc=X.
--        --def=Y       Defines --def=Y.
--        -g, --gg=Z    Define -g and --gg= with required Z arg.
--        -j Z          Define -j with required Z arg.
--        -k[Z]         Define -k with optional Z arg, with no space.
--        --color[=WHEN],   <-- Notice the `,`
--        --colour[=WHEN]
--
-- Some flags have a predefined list of args:
--
--        --foo=XYZ     description which could be
--                      more than one line
--                      XYZ is 'a', 'b', or 'c'
--
-- Recognizes many variations of file and dir arg types.
-- Other arg types use fromhistory=true.
--
-- Special exception:
--
--      A minus sign followed by an arbitrary number isn't representable as a
--      flag in Clink.
--
local function gnu_parser(context, flags, descriptions, hideflags, line)
    local x = line:match('^                +([^ ].+)$')
    if x then
        -- The line is an arg list.
        if not context.arg_line_missing_desc and
                context.pending and
                context.pending.expect_args then
            local words = string.explode(line, ' ,')
            if clink.upper(words[1]) == words[1] and words[2] == 'is' then
                local arglist = {}
                for _,w in ipairs(words) do
                    local arg = w:match("^'(.*)'$")
                    if arg then
                        table.insert(arglist, arg)
                    end
                end
                context.pending.argmatcher = clink.argmatcher():addarg(arglist)
                context.pending.expect_args = nil
            end
        else
            -- The line is part of a description.
            context.arg_line_missing_desc = nil
            if context.desc then
                context.desc = context.desc .. ' '
            end
            context.desc = (context.desc or '') .. x
        end
    else
        -- Add any pending flags.
        if context.pending then
            if context.desc then
                context.expect_args = context.desc:find(';$')
                context.desc = context.desc:gsub('%.+$', '')
                context.desc = context.desc:gsub(';$', '')
                context.desc = sentence_casing(context.desc)
                context.pending.desc = context.desc
                context.desc = nil
            end
            for _,f in ipairs(context.pending) do
                if f.flag == '-NUM' then -- luacheck: ignore 542
                    -- Clink can't represent minus followed by any number.
                    --TODO:  This is possible with onarg and onlink callbacks.
                else
                    context.pending.flag = f.flag
                    context.pending.has_arg = f.has_arg or (f.has_arg == nil and context.pending.arginfo)
                    local display = f.display
                    if not display and context.pending.has_arg then
                        display = context.pending.arginfo
                    end
                    if not display then
                        context.pending.display = nil
                    elseif f.flag:match('[:=]$') then
                        context.pending.display = display:gsub('^[ \t]', '')
                    else
                        context.pending.display = ' ' .. display:gsub('^[ \t]', '')
                    end
                    add_pending(context, flags, descriptions, hideflags, context.pending)
                end
            end
            context.pending = {}
            context.arg_line_missing_desc = nil
        end
        -- Parse if the line declares one or more flags.
        local s = line:match('^  +(%-.+)$')
        if s then
            if context.carryover then
                s = context.carryover .. ' ' .. s
                context.carryover = nil
            end
            local gap = find_flag_gap(s)
            if not gap and s:find(',$') then
                context.carryover = s
            else
                if gap then
                    context.arg_line_missing_desc = false
                    context.desc = s:sub(gap.ofs + gap.len):match('^[ \t]*([^ \t].*)$')
                    s = s:sub(1, gap.ofs - 1)
                else
                    context.arg_line_missing_desc = true
                end
                -- All flags on a single line share one argmatcher.
                local d
                local list = string.explode(s, ',')
                context.pending.expect_args = nil
                for _,f in ipairs(list) do
                    f = f:match('^ *([^ ].*)$')
                    if f then
                        if f:find('%[=') then
                            -- Add two flags.
                            f,d = f:match('^([^[]+)%[=(.*)%]$')
                            if f then
                                local feq = f .. '='
                                context.pending.arginfo = d
                                context.pending.expect_args = true
                                table.insert(context.pending, { flag=f, has_arg=false })
                                table.insert(context.pending, { flag=feq, has_arg=true, display=d })
                            end
                        elseif f:find('%[') then
                            -- Add a flag with just an arginfo hint.
                            local arginfo
                            f,arginfo = f:match('^([^[]+)(.*)$')
                            if f then
                                table.insert(context.pending, { flag=f, has_arg=false, display=arginfo })
                            end
                        elseif f:find('=') then
                            -- Add a flag with an arg.
                            f,d = f:match('^([^=]+=)(.*)$')
                            if f then
                                context.pending.arginfo = d
                                context.pending.expect_args = true
                                table.insert(context.pending, { flag=f, has_arg=true, display=d })
                            end
                        elseif f:find(' ') then
                            -- Add a flag with an arg.
                            f,d = f:match('^([^ ]+)( .*)$')
                            if f then
                                context.pending.arginfo = d
                                context.pending.expect_args = true
                                table.insert(context.pending, { flag=f, has_arg=true, display=d })
                            end
                        else
                            -- Add a flag verbatim.
                            table.insert(context.pending, { flag=f })
                        end
                    end
                end
            end
        end
    end
end

--------------------------------------------------------------------------------
local _parsers = {
    ['basic'] = basic_parser,
    ['curl'] = curl_parser,
    ['gnu'] = gnu_parser,
}

--------------------------------------------------------------------------------
local function get_parser(parser)
    return _parsers[parser:lower()]
end

--------------------------------------------------------------------------------
local function run(argmatcher, parser, command, config)
    if type(parser) ~= "function" then
        parser = parser and _parsers[parser:lower()] or basic_parser
    end

    local flags = {}
    local descriptions = {}
    local hideflags = {}
    local context = { pending={} }
    config = config or {}

    if type(command) == "table" then
        if not command[1] then
            return
        end
        for _, line in ipairs(command) do
            parser(context, flags, descriptions, hideflags, line)
        end
    else
        local r = io.popen('2>nul ' .. command)
        if not r then
            return
        end

        for line in r:lines() do
            if unicode.fromcodepage then -- luacheck: no global
                line = unicode.fromcodepage(line) -- luacheck: no global
            end
            parser(context, flags, descriptions, hideflags, line)
        end
        r:close()
    end
    parser(context, flags, descriptions, hideflags, "")

    if config.slashes then
        local slashes = {}
        for _, f in ipairs(flags) do
            if f.flag:match('^%-[^-]') then
                local sf = f.flag:gsub('^%-', '/')
                table.insert(slashes, { flag=sf, args=f.args })
                descriptions[sf] = descriptions[f.flag]
            end
        end
        for _, sf in ipairs(slashes) do
            table.insert(flags, sf)
        end
    end

    local caseless
    if config.case == 1 then
        -- Caseless:  Explicitly forcing caseless.
        caseless = true
    elseif config.case == nil then
        -- Smart case:  Caseless if all flags are upper case.
        caseless = true
        for _, f in ipairs(flags) do
            local lower = clink.lower(f.flag)
            if lower == f.flag then
                local upper = clink.upper(f.flag)
                if upper ~= f.flag then
                    caseless = false
                    break
                end
            end
        end
    end

    local actual_flags = {}

    if caseless then
        for _, f in ipairs(flags) do
            local lower = clink.lower(f.flag)
            if f.flag ~= lower then
                if f.args then
                    table.insert(actual_flags, lower .. f.args)
                else
                    table.insert(actual_flags, lower)
                end
                table.insert(hideflags, lower)
            end
        end
    end

    for _, f in ipairs(flags) do
        if f.args then
            table.insert(actual_flags, f.flag .. f.args)
        else
            table.insert(actual_flags, f.flag)
        end
    end

    argmatcher:addflags(actual_flags)
    argmatcher:adddescriptions(descriptions)
    argmatcher:hideflags(hideflags)
end

--------------------------------------------------------------------------------
local _inited = {}
local function make(command, help_flag, parser, config, closure)
    clink.argmatcher(command):setdelayinit(function (argmatcher)
        if not _inited[command] then
            _inited[command] = true
            run(argmatcher, parser, help_flag and (command .. ' ' .. help_flag) or command, config)
            if type(closure) == "function" then
                closure(argmatcher)
            end
        end
    end)
end

--------------------------------------------------------------------------------
return {
    run=run,
    make=make,
    add_pending=add_pending,
    get_parser=get_parser,
}
