-- Completions for VSCode.

require('arghelper')

local dir_matcher = clink.argmatcher():addarg(clink.dirmatches)
--local file_matcher = clink.argmatcher():addarg(clink.filematches)
local locale_matcher = clink.argmatcher():addarg({fromhistory=true})
local profile_matcher = clink.argmatcher():addarg({fromhistory=true})
local category_matcher = clink.argmatcher():addarg({fromhistory=true})
local sync_matcher = clink.argmatcher():addarg({nosort=true, "on", "off"})
local port_matcher = clink.argmatcher():addarg({fromhistory=true})
local maxmemory_matcher = clink.argmatcher():addarg({fromhistory=true})

local level_matcher = clink.argmatcher()
:addarg({nosort=true, "critical", "error", "warn", "info", "debug", "trace", "off"})

-- Extension ID matchers.  Could potentially merge them, but install_parser is
-- the most interesting one to merge, and yet it can't be merged because it
-- defines flags.
local uninstall_matcher = clink.argmatcher():addarg({fromhistory=true})
local enabledproposedapi_matcher = clink.argmatcher():addarg({fromhistory=true})
local disableextension_matcher = clink.argmatcher():addarg({fromhistory=true})

local function append_colon(word, word_index, line_state, builder, user_data) -- luacheck: no unused
    builder:setappendcharacter(":")
end

local function vsix_files(match_word)
    if clink.filematchesexact then
        return clink.filematchesexact(match_word.."*.vsix")
    else
        local word, expanded = rl.expandtilde(match_word)

        local root = (path.getdirectory(word) or ""):gsub("/", "\\")
        if expanded then
            root = rl.collapsetilde(root)
        end

        local _, ismain = coroutine.running()

        local matches = {}
        for _, i in ipairs(os.globfiles(word.."*", true)) do
            if i.type:find("dir") or i.name:find("%.vsix$") then
                local m = path.join(root, i.name)
                table.insert(matches, { match = m, type = i.type })
                if not ismain and _ % 250 == 0 then
                    coroutine.yield()
                end
            end
        end
        return matches
    end
end

local diff_parser = clink.argmatcher()
:addarg(clink.filematches)
:addarg(clink.filematches)

local merge_parser = clink.argmatcher()
:addarg(clink.filematches)
:addarg(clink.filematches)
:addarg(clink.filematches)
:addarg(clink.filematches)

local add_parser = clink.argmatcher()
:addarg(clink.dirmatches)

local goto_parser = clink.argmatcher()
:addarg(clink.filematches, append_colon)

local list_parser = clink.argmatcher()
:_addexflags({
    {"--category"..category_matcher, " category", "Filters installed extensions by provided category"},
    {"--show-versions", "Show versions of installed extensions"},
})

local install_parser = clink.argmatcher()
:addarg(vsix_files)
:_addexflags({
    {"--force",         "Update extension to latest version"},
    {"--pre-relese",    "Install the pre-release version of the extension"},
})

-- luacheck: no max line length
clink.argmatcher("code")
:_addexflags({
    -- Options
    {"-d"..diff_parser, " file file",                       "Compare two files with each other"},
    {"--diff"..diff_parser, " file file", ""},
    {"-m"..merge_parser, " file1 file2 base result",        "Perform a three-way merge"},
    {"--merge"..merge_parser, " file1 file2 base result", ""},
    {"-a"..add_parser, " folder",                           "Add folder(s) to the last active window"},
    {"--add"..add_parser, " folder", ""},
    {"-g"..goto_parser, " file:line[:char]",                "Open a file and position the cursor"},
    {"--goto"..goto_parser, " file:line[:char]", ""},
    {"-n",                                                  "Force to open a new window"},
    {"--new-window"},
    {"-r",                                                  "Force to use an already opened window"},
    {"--reuse-window"},
    {"-w",                                                  "Wait for the files to be closed before returning"},
    {"--wait"},
    {"--locale"..locale_matcher, " locale", ""},
    {"--user-data-dir"..dir_matcher, " dir", ""},
    {"--profile"..profile_matcher, " dir", ""},
    {"-h",                                                  "Print usage"},
    {"--help"},

    -- Extensions Management
    {"--extensions-dir"..dir_matcher, " dir", ""},
    {"--list-extensions"..list_parser},
    {"--install-extension"..install_parser, " ext_id|path", ""},
    {"--uninstall-extension"..uninstall_matcher, " ext_id", ""},
    {"--enable-proposed-api"..enabledproposedapi_matcher, " ext_id", ""},

    -- Troubleshooting
    {"-v",                                                  "Print version"},
    {"--version"},
    {"--verbose"},
    {"--log"..level_matcher, " level", ""},
    {"-s",                                                  "Print process usage and diagnostics info"},
    {"--status"},
    {"--prof-startup"},
    {"--disable-extensions"},
    {"--disable-extension"..disableextension_matcher, " ext_id", ""},
    {"--sync"..sync_matcher, " on|off", ""},
    {"--inspect-extensions"..port_matcher, " port", ""},
    {"--inspect-brk-extensions"..port_matcher, " port", ""},
    {"--disable-gpu"},
    {"--max-memory"..maxmemory_matcher, " memory", ""},
    {"--telemetry"},

    -- Other
    {"--trace-deprecation"},
})
