--------------------------------------------------------------------------------
-- It would have been great to simply use the "winget complete" command.  But
-- it has two problems:
--      1.  It doesn't provide completions for lots of things (esp. arguments
--          for most flags).  It never provides filename or directory matches.
--      2.  It can't support input line coloring, because there's no way to
--          populate the parse tree in advance, and because there's no way to
--          reliably infer the parse tree.
--
-- However, we'll use it where we can, because it does provide fancy
-- completions for some things (at least when a partial word is entered, e.g.
-- for `winget install Power` which finds package names with prefix "Power").

local standalone = not clink or not clink.argmatcher
local clink_version = require('clink_version')

--------------------------------------------------------------------------------
-- Helper functions.

-- luacheck: max line length 100

-- Clink v1.4.12 and earlier fall into a CPU busy-loop if
-- match_builder:setvolatile() is used during an autosuggest strategy.
local volatile_fixed = clink_version.has_volatile_matches_fix

local function sanitize_word(line_state, index, info)
    if not info then
        info = line_state:getwordinfo(index)
    end

    local end_offset = info.offset + info.length - 1
    if volatile_fixed and end_offset < info.offset and index == line_state:getwordcount() then
        end_offset = line_state:getcursor() - 1
    end

    local word = line_state:getline():sub(info.offset, end_offset)
    word = word:gsub('"', '\\"')
    return word
end

local function append_word(text, word)
    if #text > 0 then
        text = text .. " "
    end
    return text .. word
end

local function sanitize_line(line_state)
    local text = ""
    for i = 1, line_state:getwordcount() do
        local info = line_state:getwordinfo(i)
        local word
        if info.alias then
            word = "winget"
        elseif not info.redir then
            word = sanitize_word(line_state, i, info)
        end
        if word then
            text = append_word(text, word)
        end
    end
    local endword = sanitize_word(line_state, line_state:getwordcount())
    return text, endword
end

local debug_print_query
if tonumber(os.getenv("DEBUG_CLINK_WINGET") or "0") > 0 then
    local query_count = 0
    local color_index = 0
    local color_values = { "52", "94", "100", "22", "23", "19", "53" }
    debug_print_query = function (endword)
        query_count = query_count + 1
        color_index = color_index + 1
        if color_index > #color_values then
            color_index = 1
        end
        clink.print("\x1b[s\x1b[H\x1b[1;37;48;5;"..color_values[color_index].."mQUERY #"..query_count..", endword '"..endword.."'\x1b[m\x1b[K\x1b[u", NONL) -- luacheck: no max line length, no global
    end
else
    debug_print_query = function () end
end

local function winget_complete(word, index, line_state, builder) -- luacheck: no unused args
    local matches = {}
    local winget = os.getenv("LOCALAPPDATA")

    -- In the background (async auto-suggest), delay `winget complete` by 200 ms
    -- to coalesce rapid keypresses into a single query.  Overall, this improves
    -- the responsiveness for showing auto-suggestions which involve slow
    -- network queries.  The drawback is that all background `winget complete`
    -- queries take 200 milliseconds longer to show results.  But it can save
    -- many seconds, so on average it works out as feeling more responsive.
    if winget and volatile_fixed and builder.setvolatile and rl.islineequal then
        local co, ismain = coroutine.running()
        if not ismain then
            local orig_line = line_state:getline():sub(1, line_state:getcursor() - 1)
            clink.setcoroutineinterval(co, .2)
            coroutine.yield()
            clink.setcoroutineinterval(co, 0)
            if not rl.islineequal(orig_line, true) then
                winget = nil
                builder:setvolatile()
            end
        end
    end

    if winget then
        winget = '"'..path.join(winget, "Microsoft\\WindowsApps\\winget.exe")..'"'

        local commandline, endword = sanitize_line(line_state)
        debug_print_query(endword)
        local command = '2>nul '..winget..' complete --word="'..endword..'" --commandline="'..commandline..'" --position=99999' -- luacheck: no max line length
        local f = io.popen(command)
        if f then
            for line in f:lines() do
                line = line:gsub('"', '')
                if line ~= "" and (standalone or line:sub(1,1) ~= "-") then
                    table.insert(matches, line)
                end
            end
            f:close()
        end

        -- Mark the matches volatile even when generation was skipped due to
        -- running in a coroutine.  Otherwise it'll never run it in the main
        -- coroutine, either.
        if volatile_fixed and builder.setvolatile then
            builder:setvolatile()
        end

        -- Enable quoting.
        if builder.setforcequoting then
            builder:setforcequoting()
        elseif clink.matches_are_files then
            clink.matches_are_files()
        end
    end
    return matches
end

--------------------------------------------------------------------------------
-- When this script is run as a standalone Lua script, it can traverse the
-- available winget commands and flags and output the available completions.
-- This helps when updating the completions this script supports.

if standalone then

    local function ignore_match(match)
        if match == "--help" or
                match == "--no-vt" or
                match == "--rainbow" or
                match == "--retro" or
                match == "--verbose-logs" or
                false then
            return true
        end
    end

    local function dump_completions(line, recursive)
        local line_state = clink.parseline(line..' ""')[1].line_state
        local t = winget_complete("", 0, line_state, {})
        if #t > 0 then
            print(line)
            for _, match in ipairs(t) do
                if not ignore_match(match) then
                    print("", match)
                end
            end
            print()
            if recursive then
                for _, match in ipairs(t) do
                    if not ignore_match(match) then
                        dump_completions(line.." "..match, not match:find("^-") )
                    end
                end
            end
        end
    end

    dump_completions("winget", true)
    return

end

--------------------------------------------------------------------------------
-- Parsers for linking.

-- TODO: ideally "winget complete" could list the available settings so that
-- setting_name_matches could list actual setting names.

local arghelper = require("arghelper")

local empty_arg = clink.argmatcher():addarg()
local contextual_matches = clink.argmatcher():addarg({winget_complete})

local add_source_matches = empty_arg
local arch_matches = contextual_matches
local command_matches = contextual_matches
local count_matches = clink.argmatcher():addarg({fromhistory=true, 10, 20, 40})
local dependency_source_matches = clink.argmatcher():addarg({fromhistory=true})
local file_matches = clink.argmatcher():addarg(clink.filematches)
local header_matches = clink.argmatcher():addarg({fromhistory=true})
local id_matches = contextual_matches
local locale_matches = clink.argmatcher():addarg({fromhistory=true})
local location_matches = clink.argmatcher():addarg(clink.dirmatches)
local moniker_matches = contextual_matches
local name_matches = contextual_matches
local override_matches = clink.argmatcher():addarg({fromhistory=true})
local productcode_matches = clink.argmatcher():addarg({fromhistory=true})
local query_matches = clink.argmatcher():addarg({fromhistory=true})
local scope_matches = contextual_matches
local setting_name_matches = clink.argmatcher():addarg({fromhistory=true})
local source_matches = contextual_matches
local tag_matches = contextual_matches
local type_matches = clink.argmatcher():addarg({"Microsoft.PreIndexed.Package"})
local url_matches = empty_arg
local version_matches = contextual_matches

--------------------------------------------------------------------------------
-- Factored flag definitions.

-- luacheck: no max line length

local arch_locale_flags = {
    { hide=true,    "-a"                .. arch_matches },
    {               "--architecture"    .. arch_matches,        " arch",        "Select the architecture to install" },
    {               "--locale"          .. locale_matches,      " locale",      "Locale to use (BCP47 format)" },
}

local common_flags = {
    {               "--verbose-logs",                                           "Enables verbose logging for WinGet" },
    {               "--logs",                                                   "Opens the default logs location" },
    { hide=true,    "--no-vt" },
    { hide=true,    "--rainbow" },
    { hide=true,    "--retro" },
    {               "--help",                                                   "Shows help about the selected command" },
    { hide=true,    "-?" },
    { hide=true,    "--wait",                                                   "Prompts the user to press any key before exiting" },
    { hide=true,    "--disable-interactivity",                                  "Disable interactive prompts" },
    { hide=true,    "--verbose",                                                "Enables verbose logging for WinGet" },
    { hide=true,    "--open-logs",                                              "Opens the default logs location" },
}

local source_name_flags = {
    { hide=true,    "-n"                .. source_matches },
    {               "--name"            .. source_matches,      " name",        "Name of the source" },
}

local query_flags = {
    { hide=true,    "-q"                .. query_matches },
    {               "--query"           .. query_matches,       " query",       "The query used to search for a package" },
    {               "--id"              .. id_matches,          " id",          "Filter results by id" },
    {               "--name"            .. name_matches,        " name",        "Filter results by name" },
    {               "--moniker"         .. moniker_matches,     " moniker",     "Filter results by moniker" },
    { hide=true,    "-e" },
    {               "--exact",                                                  "Find package using exact match" },
}

local query_flags_more = {
    {               "--tag"             .. tag_matches,         " tag",         "Filter results by tag" },
    {               "--command"         .. command_matches,     " command",     "Filter results by command" },
    { hide=true,    "-n"                .. count_matches },
    {               "--count"           .. count_matches,       " count",       "Show no more than specified number of results (between 1 and 1000)" },
}

local source_flags = {
    { hide=true,    "-s"                .. source_matches },
    {               "--source"          .. source_matches,      " source",      "Find package using the specified source" },
}

--------------------------------------------------------------------------------
-- Command parsers.

local export_parser = clink.argmatcher()
:_addexflags({
    opteq=true,
    common_flags,
    source_flags,
    { hide=true,    "-o"                .. file_matches },
    {               "--output"          .. file_matches,        " file",        "File where the result is to be written" },
    { hide=true,    "--include-versions" },
    { hide=true,    "--accept-source-agreements" },
})
:addarg(clink.filematches)
:nofiles()

local features_parser = clink.argmatcher()
:_addexflags({
    common_flags,
})
:nofiles()

local hash_parser = clink.argmatcher()
:_addexflags({
    opteq=true,
    common_flags,
    { hide=true,    "-f"                .. file_matches },
    {               "--file"            .. file_matches,        " file",        "File to be hashed"},
    { hide=true,    "-m" },
    {               "--msix",                                                   "Input file will be treated as msix; signature hash will be provided if signed" },
})
:addarg(clink.filematches)
:nofiles()

local import_parser = clink.argmatcher()
:_addexflags({
    opteq=true,
    common_flags,
    { hide=true,    "-i"                .. file_matches },
    {               "--import-file"     .. file_matches,        " file",        "File describing the packages to install" },
    {               "--ignore-unavailable",                                     "Ignore unavailable packages" },
    {               "--ignore-versions",                                        "Ignore package versions in import file" },
    {               "--no-upgrade",                                             "Skips upgrade if an installed version already exists" },
    {               "--accept-package-agreements",                              "Accept all license agreements for packages" },
    {               "--accept-source-agreements",                               "Accept all source agreements during source operations" },
})
:addarg(clink.filematches)
:nofiles()

local install_parser = clink.argmatcher()
:_addexflags({
    opteq=true,
    common_flags,
    query_flags,
    source_flags,
    arch_locale_flags,
    { hide=true,    "-m"                .. file_matches },
    {               "--manifest"        .. file_matches,        " file",        "The path to the manifest of the package" },
    { hide=true,    "-v"                .. version_matches },
    {               "--version"         .. version_matches,     " version",     "Use the specified version; default is the latest version" },
    {               "--scope"           .. scope_matches,       " scope",       "Select install scope (user or machine)" },
    { hide=true,    "-i" },
    {               "--interactive",                                            "Request interactive installation; user input may be needed" },
    { hide=true,    "-h" },
    {               "--silent",                                                 "Request silent installation" },
    { hide=true,    "-o"                .. file_matches },
    {               "--log"             .. file_matches,        " file",        "Log location (if supported)" },
    {               "--override"        .. override_matches,    " string",      "Override arguments to be passed on to the installer" },
    { hide=true,    "-l"                .. location_matches },
    {               "--location"        .. location_matches,    " location",    "Location to install to (if supported)" },
    {               "--force",                                                  "Override the installer hash check" },
    {               "--ignore-security-hash",                                   "Ignore the installer hash check failure" },
    {               "--ignore-local-archive-malware-scan",                      "Ignore the malware scan performed as part of installing an archive type package from local manifest" },
    {               "--dependency-source" .. dependency_source_matches, " source", "Find package dependencies using the specified source" },
    {               "--accept-package-agreements",                              "Accept all license agreements for packages" },
    {               "--accept-source-agreements",                               "Accept all source agreements during source operations" },
    {               "--no-upgrade",                                             "Skips upgrade if an installed version already exists" },
    {               "--header"          .. header_matches,      " header",      "Optional Windows-Package-Manager REST source HTTP header" },
    { hide=true,    "-r"                .. file_matches },
    {               "--rename"          .. file_matches,        " file",        "The value to rename the executable file (portable)" },
})
:addarg({winget_complete})
:nofiles()

local __search_parser_flags = {
    query_flags,
    query_flags_more,
    source_flags,
    { hide=true,    "--accept-source-agreements" },
    {               "--header"          .. header_matches,      " header",      "Optional Windows-Package-Manager REST source HTTP header" },
    common_flags,
}

local list_parser = clink.argmatcher()
:_addexflags({
    opteq=true,
    __search_parser_flags,
    {               "--scope"           .. scope_matches,       " scope",       "Select installed package scope filter (user or machine)" },
})
:addarg({winget_complete})
:nofiles()

local search_parser = clink.argmatcher()
:_addexflags({
    opteq=true,
    __search_parser_flags,
})
:addarg({winget_complete})
:nofiles()

local settings_export_parser = clink.argmatcher()
:_addexflags({
    opteq=true,
    common_flags,
})
:nofiles()

local settings_parser = clink.argmatcher()
:_addexflags({
    {               "--enable"          .. setting_name_matches, " setting",    "Enables the specific administrator setting" },
    {               "--disable"         .. setting_name_matches, " setting",    "Disables the specific administrator setting" },
})
:_addexarg({
    { "export" .. settings_export_parser, "Export settings as JSON" },
})
:nofiles()

local show_parser = clink.argmatcher()
:_addexflags({
    opteq=true,
    common_flags,
    query_flags,
    source_flags,
    arch_locale_flags,
    { hide=true,    "-m" .. file_matches },
    {               "--manifest"        .. file_matches,        " file",        "The path to the manifest of the package" },
    { hide=true,    "-v" .. version_matches },
    {               "--version"         .. version_matches,     " version",     "Use the specified version; default is the latest version" },
    {               "--versions",                                               "Show available versions of the package" },
    {               "--header"          .. header_matches,      " header",      "Optional Windows-Package-Manager REST source HTTP header" },
    {               "--accept-source-agreements",                               "Accept all source agreements during source operations" },
})
:addarg({winget_complete})
:nofiles()

local source_add_parser = clink.argmatcher()
:_addexflags({
    opteq=true,
    common_flags,
    { hide=true,    "-n"                .. add_source_matches },
    {               "--name"            .. add_source_matches,  " name",        "Name of the source" },
    { hide=true,    "-a"                .. url_matches },
    {               "--arg"             .. url_matches,         " url",         "Argument given to the source" },
    { hide=true,    "-t"                .. type_matches },
    {               "--type"            .. type_matches,        " type",        "Type of the source" },
    {               "--header"          .. header_matches,      " header",      "Optional Windows-Package-Manager REST source HTTP header" },
    {               "--accept-source-agreements",                               "Accept all source agreements during source operations" },
})
:addarg(add_source_matches)
:nofiles()
-- REVIEW: :nofiles() isn't really accurate here, but I don't see a good way to
-- accurately support the command's syntax given that "-n" and "-a" are optional
-- but the "name" and "arg" arguments they refer to are required.  So input like
-- "winget source add -n name arg" is weird because "arg" ends up getting parsed
-- as being in the argmatcher's 1st arg position, because the "name" is an
-- argument to the "-n" flag, not an argument to the "winget add" command.

local source_list_parser = clink.argmatcher()
:_addexflags({
    opteq=true,
    common_flags,
    source_name_flags,
})
:addarg(source_matches)
:nofiles()

local source_update_parser = clink.argmatcher()
:_addexflags({
    opteq=true,
    common_flags,
    source_name_flags,
})
:addarg(source_matches)
:nofiles()

local source_remove_parser = clink.argmatcher()
:_addexflags({
    opteq=true,
    common_flags,
    source_name_flags,
})
:addarg(source_matches)
:nofiles()

local source_reset_parser = clink.argmatcher()
:_addexflags({
    opteq=true,
    common_flags,
    source_name_flags,
    {               "--force",                                                  "Forces the reset of the sources" },
})
:addarg(source_matches)
:nofiles()

local source_export_parser = clink.argmatcher()
:_addexflags({
    opteq=true,
    source_name_flags,
    common_flags,
})
:addarg(source_matches)
:nofiles()

local source_parser = clink.argmatcher()
:_addexflags({
    opteq=true,
    common_flags,
})
:_addexarg({
    { "add"         .. source_add_parser,       " name arg [type]",             "Add a new source" },
    { "list"        .. source_list_parser,      " [name]",                      "List current sources" },
    {   "ls"        .. source_list_parser },
    { "update"      .. source_update_parser,    " [name]",                      "Update current sources" },
    {   "refresh"   .. source_update_parser },
    { "remove"      .. source_remove_parser,    "Remove current sources" },
    {   "rm"        .. source_remove_parser },
    { "reset"       .. source_reset_parser,     "Reset sources" },
    { "export"      .. source_export_parser,    "Export current sources" },
    arghelper.make_arg_hider_func({"ls", "refresh", "rm"}),
})
:nofiles()

local uninstall_parser = clink.argmatcher()
:_addexflags({
    opteq=true,
    common_flags,
    query_flags,
    query_flags_more,
    source_flags,
    { hide=true,    "-m"                .. file_matches },
    {               "--manifest"        .. file_matches,        " file",        "The path to the manifest of the package" },
    {               "--product-code"    .. productcode_matches, " code",        "Filters using the product code" },
    { hide=true,    "-v"                .. version_matches },
    {               "--version"         .. version_matches,     " version",     "Use the specified version; default is the latest version" },
    {               "--scope"           .. scope_matches,       " scope",       "Select installed package scope filter (user or machine)" },
    { hide=true,    "-i" } ,
    {               "--interactive",                                            "Request interactive installation; user input may be needed" },
    { hide=true,    "-h" } ,
    {               "--silent",                                                 "Request silent uninstallation" },
    {               "--force",                                                  "Direct run the command and continue with non security related issues" },
    {               "--purge",                                                  "Deletes all files and directories in the package directory (portable)" },
    {               "--preserve",                                               "Retains all files and directories created by the package (portable)" },
    { hide=true,    "-o"                .. file_matches },
    {               "--log"             .. file_matches,        " file",        "Log location (if supported)" },
    {               "--accept-source-agreements",                               "Accept all source agreements during source operations" },
    {               "--header"          .. header_matches,      " header",      "Optional Windows-Package-Manager REST source HTTP header" },
})
:addarg({winget_complete})
:nofiles()

local upgrade_parser = clink.argmatcher()
:_addexflags({
    opteq=true,
    common_flags,
    query_flags,
    source_flags,
    arch_locale_flags,
    { hide=true,    "-m"                .. file_matches },
    {               "--manifest"        .. file_matches,        " file",        "The path to the manifest of the package" },
    { hide=true,    "-v"                .. version_matches },
    {               "--version"         .. version_matches,     " version",     "Use the specified version; default is the latest version" },
    { hide=true,    "-i" },
    {               "--interactive",                                            "Request interactive installation; user input may be needed" },
    { hide=true,    "-h" },
    {               "--silent",                                                 "Request silent installation" },
    {               "--purge",                                                  "Deletes all files and directories in the package directory (portable)" },
    { hide=true,    "-o"                .. file_matches },
    {               "--log"             .. file_matches,        " file",        "Log location (if supported)" },
    {               "--override"        .. override_matches,    " string",      "Override arguments to be passed on to the installer" },
    { hide=true,    "-l"                .. location_matches },
    {               "--location"        .. location_matches,    " location",    "Location to install to (if supported)" },
    {               "--scope"           .. scope_matches,       " scope",       "Select installed package scope filter (user or machine)" },
    {               "--ignore-security-hash",                                   "Ignore the installer hash check failure" },
    {               "--ignore-local-archive-malware-scan",                      "Ignore the malware scan performed as part of installing an archive type package from local manifest" },
    {               "--force",                                                  "Direct run the command and continue with non security related issues" },
    {               "--accept-package-agreements",                              "Accept all license agreements for packages" },
    {               "--accept-source-agreements",                               "Accept all source agreements during source operations" },
    {               "--header"          .. header_matches,      " header",      "Optional Windows-Package-Manager REST source HTTP header" },
    { hide=true,    "-r" },
    { hide=true,    "--recurse" },
    {               "--all",                                                    "Update all installed packages to latest if available" },
    { hide=true,    "-u" },
    { hide=true,    "--unknown" },
    {               "--include-unknown",                                        "Upgrade packages even if their current version cannot be determined" },
})
:addarg({winget_complete})
:nofiles()

local validate_parser = clink.argmatcher()
:_addexflags({
    opteq=true,
    common_flags,
    {               "--manifest"        .. file_matches,        " file",        "The path to the manifest to be validated" },

})
:addarg(clink.filematches)
:nofiles()

local complete_parser = clink.argmatcher()
:_addexflags({
    nosort=true,
    {               "--word"            .. empty_arg,           " word",        "The value provided before completion is requested" },
    {               "--commandline"     .. empty_arg,           " text",        "The full command line for completion" },
    {               "--position"        .. empty_arg,           " num",         "The position of the cursor within the command line" },
})
:nofiles()

--------------------------------------------------------------------------------
-- Define the winget argmatcher.

local winget_command_data_table = {
    { "install",    install_parser,     "add",          disp=" [query]",    desc="Installs the given package" },
    { "show",       show_parser,        "view",         disp=" [query]",    desc="Shows information about a package" },
    { "source",     source_parser,                      disp=" command",    desc="Manage sources of packages" },
    { "search",     search_parser,      "find",         disp=" [query]",    desc="Find and show basic info of packages" },
    { "list",       list_parser,        "ls",           disp=" [query]",    desc="Display installed packages" },
    { "upgrade",    upgrade_parser,     "update",       disp=" [query]",    desc="Shows and performs available upgrades" },
    { "uninstall",  uninstall_parser,   "rm", "remove", disp=" [query]",    desc="Uninstalls the given package" },
    { "hash",       hash_parser,                        disp=" file",       desc="Helper to hash installer files" },
    { "validate",   validate_parser,                    disp=" manifest",   desc="Validates a manifest file" },
    { "settings",   settings_parser,    "config",       disp=" [command]",  desc="Open settings or set administrator settings" },
    { "features",   features_parser,                                        desc="Shows the status of experimental features" },
    { "export",     export_parser,                      disp=" output",     desc="Exports a list of the installed packages" },
    { "import",     import_parser,                      disp=" importfile", desc="Installs all the packages in a file" },
    { nil,          complete_parser,    "complete" },
}

-- luacheck: max line length 100

local hidden_aliases = {}
local winget_commands = {}

for _,c in ipairs(winget_command_data_table) do
    local i = 3
    while c[i] do
        if c[2] then
            table.insert(winget_commands, c[i]..c[2])
        else
            table.insert(winget_commands, c[i])
        end
        table.insert(hidden_aliases, c[i])
        i = i + 1
    end
    if c[1] then
        if c[2] then
            table.insert(winget_commands, { c[1]..c[2], c.disp or "", c.desc })
        else
            table.insert(winget_commands, { c[1], c.disp or "", c.desc })
        end
    end
end

table.insert(winget_commands, arghelper.make_arg_hider_func(hidden_aliases))

clink.argmatcher("winget")
:_addexarg(winget_commands)
:_addexflags({
    common_flags,
    { hide=true,    "-v" },
    {               "--version",    "Display the version of the tool" },
    {               "--info",       "Display general info of the tool" },
})
