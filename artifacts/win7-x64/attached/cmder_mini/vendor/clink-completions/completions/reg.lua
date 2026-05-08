require("arghelper")

local function keyname_impl(restricted, _, word_index, line_state, builder, _)
    local matches = {}
    local info = line_state:getwordinfo(word_index)
    if info then
        local word = line_state:getline():sub(info.offset, line_state:getcursor() - 1) or ""

        local machine = word:match("^(\\\\[^\\]+\\)") or ""
        word = word:sub(#machine + 1)

        if not word:find("\\") then
            matches.nosort = true
            if word:match("^[Hh][Kk][LlCcUu]") then
                if restricted then
                    table.insert(matches, machine.."HKLM")
                else
                    table.insert(matches, machine.."HKCU")
                    table.insert(matches, machine.."HKLM")
                    table.insert(matches, machine.."HKCC")
                    table.insert(matches, machine.."HKCR")
                    table.insert(matches, machine.."HKU")
                end
            else
                if restricted then
                    table.insert(matches, machine.."HKEY_LOCAL_MACHINE")
                else
                    table.insert(matches, machine.."HKEY_CURRENT_USER")
                    table.insert(matches, machine.."HKEY_LOCAL_MACHINE")
                    table.insert(matches, machine.."HKEY_CURRENT_CONFIG")
                    table.insert(matches, machine.."HKEY_CLASSES_ROOT")
                    table.insert(matches, machine.."HKEY_USERS")
                end
            end
        elseif restricted and word:upper():find("^HKLM\\+[^\\]*$") then
            table.insert(matches, machine.."HKLM\\SOFTWARE")
        elseif restricted and word:upper():find("^HKEY_LOCAL_MACHINE\\+[^\\]*$") then
            table.insert(matches, machine.."HKEY_LOCAL_MACHINE\\SOFTWARE")
        elseif not restricted or
                word:upper():find("^HKLM\\SOFTWARE\\") or
                word:upper():find("^HKEY_LOCAL_MACHINE\\SOFTWARE\\") then
            local lookup = word:gsub("\\+[^\\]*$", "")
            local command = string.format('2>nul reg.exe query "%s"', lookup)
            local f = io.popen(command)
            if f then
                clink.matches_are_files(true)
                local root = (word:match("^([^\\]+)\\?") or ""):upper()
                for line in f:lines() do
                    if line ~= "" then
                        if line:sub(1, #machine) == machine then
                            line = line:sub(#machine + 1)
                        end
                        if root then
                            line = line:gsub("^[^\\]+", "")
                        end
                        local key = root and root..line or line
                        table.insert(matches, machine..key)
                    end
                end
                f:close()
            end
        end
        builder:setsuppressappend()
    end
    return matches
end

local function keyname_any(word, word_index, line_state, builder, user_data)
    return keyname_impl(false, word, word_index, line_state, builder, user_data)
end

local function keyname_hklm_software(word, word_index, line_state, builder, user_data)
    return keyname_impl(true, word, word_index, line_state, builder, user_data)
end

local user_data_keyname

local function onarg_keyname(arg_index, word, _, _, user_data)
    if arg_index == 1 then
        local ud = user_data.shared_user_data and user_data.shared_user_data or user_data
        ud.keyname = word
    elseif arg_index == 0 and word == "/v" then
        user_data_keyname = user_data.keyname
    end
end

local function valuename_impl(_, _, _, _, user_data)
    local matches = {}
    if user_data then
        local keyname = user_data.shared_user_data and user_data.shared_user_data.keyname or user_data_keyname
        local command = string.format('2>nul reg.exe query "%s" /v *', keyname)
        local f = io.popen(command)
        if f then
            for line in f:lines() do
                local m, t = line:match("^    +([^<>|&%%]+)    (REG[^%s]+)")
                if m then
                    table.insert(matches, { match=m, description=t })
                end
            end
            f:close()
        end
    end
    return matches
end

local valuename = clink.argmatcher():addarg(valuename_impl)

local sep = clink.argmatcher():addarg({fromhistory=true})
local find = clink.argmatcher():addarg({fromhistory=true})
local data = clink.argmatcher():addarg({fromhistory=true})
local types = clink.argmatcher():addarg({
    nosort=true,
    "REG_DWORD",
    "REG_SZ",
    "REG_EXPAND_SZ",
    "REG_QWORD",
    "REG_MULTI_SZ",
    "REG_BINARY",
    "REG_NONE",
})

local common_flags = {
    { "/?",                 "Show help" },
    { "/reg:32",            "Specifies the key should be accessed using the 32-bit registry view" },
    { "/reg:64",            "Specifies the key should be accessed using the 64-bit registry view" },
    { hide=true, "/reg:"..clink.argmatcher():_addexarg({
        { "32",                 "Specifies the key should be accessed using the 32-bit registry view" },
        { "64",                 "Specifies the key should be accessed using the 64-bit registry view" },
    }) },
}

local query = clink.argmatcher():_addexflags({
})
:addarg({
    onarg=onarg_keyname,
    keyname_any,
})
:_addexflags({
    onarg=onarg_keyname,
    common_flags,
    { "/v"..valuename, " ValueName", "Queries for a specific registry key values" },
    { "/ve",                "Queries for the default value or empty value name (Default)" },
    { "/s",                 "Queries all subkeys and values recursively (like dir /s)" },
    { "/se"..sep, " Sep",   "Specifies the separator (1 char) for REG_MULTI_SZ (Default is \\0)" },
    { "/f"..find, " Data",  "Specifies the data or pattern to search for (Default is *)" },
    { "/k",                 "Search in key names only" },
    { "/d",                 "Search in data only" },
    { "/c",                 "Use case sensitive search" },
    { "/e",                 "Only return exact matches from search" },
    { "/t"..types, " Type", "Specifies registry value data type (Default is all types)" },
    { "/z",                 "Verbose: Shows the numeric equivalent for the type of the valuename" },
})
:nofiles()

local add = clink.argmatcher():_addexflags({
    onarg=onarg_keyname,
    common_flags,
    { "/v"..valuename, " ValueName", "The value name to add under the selected key" },
    { "/ve",                "Adds an empty value name (Default) for the key" },
    { "/t"..types, " Type", "Type to add (Default is REG_SZ)" },
    { "/s"..sep, " Sep",    "Specify one character as the separator for REG_MULTI_SZ (Default is \\0)" },
    { "/d"..data, " Data",  "The data to assign to the registry ValueName being added" },
    { "/f",                 "Force overwriting the existing registry entry without prompt" },
})
:addarg({
    onarg=onarg_keyname,
    keyname_any,
})
:nofiles()

local delete = clink.argmatcher():_addexflags({
    common_flags,
    { "/ve",                "Delete the value of empty value name (Default)" },
    { "/va",                "Delete all values under the specified key" },
    { "/f",                 "Forces deletion without prompt" },
})
:addarg(keyname_any)
:nofiles()

local copy = clink.argmatcher():_addexflags({
    common_flags,
    { "/s",                 "Copies all subkeys and values" },
    { "/f",                 "Forces the copy without prompt" },
})
:addarg(keyname_any)
:addarg(keyname_any)
:nofiles()

local save = clink.argmatcher():_addexflags({
    common_flags,
    { "/y",                 "Force overwriting the existing file without prompt" },
})
:addarg(keyname_any)
:addarg(clink.filematches)
:nofiles()

local restore = clink.argmatcher():_addexflags({
    common_flags,
})
:addarg(keyname_any)
:addarg(clink.filematches)
:nofiles()

local load = clink.argmatcher():_addexflags({
    common_flags,
})
:addarg(keyname_any)
:addarg(clink.filematches)
:nofiles()

local unload = clink.argmatcher():_addexflags({
    { "/?",                 "Show help" },
})
:addarg(keyname_any)
:nofiles()

local compare = clink.argmatcher():_addexflags({
    onarg=onarg_keyname,
    common_flags,
    { "/v"..valuename, " ValueName", "The value name to compare under the selected key (Default is all)" },
    { "/ve",                "Compare the value of empty value name (Default)" },
    { "/s",                 "Compare all subkeys and values" },
    { "/oa",                "Output all of differences and matches" },
    { "/od",                "Output only differences (Default)" },
    { "/os",                "Output only matches" },
    { "/on",                "No output (exit code 0=identical, 1=failed, 2=different)" },
})
:addarg({
    onarg=onarg_keyname,
    keyname_any,
})
:addarg(keyname_any)
:nofiles()

local export = clink.argmatcher():_addexflags({
    common_flags,
    { "/y",                 "Force overwriting the existing file without prompt" },
})
:addarg(keyname_any)
:addarg(clink.filematches)
:nofiles()

local import = clink.argmatcher():_addexflags({
    common_flags,
})
:addarg(clink.filematches)
:nofiles()

local flags_query = clink.argmatcher():_addexflags({
    common_flags,
    { "/s",                 "Queries all subkeys and values recursively (like dir /s)" },
})
:nofiles()

local flags_set = clink.argmatcher():_addexflags({
    common_flags,
    { "/s",                 "Sets flags on subkeys recursively" },
})
:addarg("dont_virtualize", "dont_silent_fail", "recurse_flag")
:loop()

local flags_commands = {
    "query" .. flags_query,
    "set" .. flags_set,
}

local flags = clink.argmatcher():_addexflags({
})
:addarg(keyname_hklm_software)
:addarg(flags_commands)
:nofiles()

local commands = {
    { "query"   .. query,   " KeyName",             "Query keys or values" },
    { "add"     .. add,     " KeyName",             "Add a key or value" },
    { "delete"  .. delete,  " KeyName",             "Delete keys or values" },
    { "copy"    .. copy,    " KeyName1 KeyName2",   "Copy keys and values" },
    { "save"    .. save,    " KeyName FileName",    "Save a hive to a file" },
    { "restore" .. restore, " KeyName FileName",    "Restore a hive from a file" },
    { "load"    .. load,    " KeyName FileName",    "Load a hive file into a key name" },
    { "unload"  .. unload,  " KeyName",             "Unload a loaded hive file from a key name" },
    { "compare" .. compare, " KeyName1 KeyName2",   "Compare keys and values" },
    { "export"  .. export,  " KeyName FileName",    "Export keys and values to a .reg file" },
    { "import"  .. import,  " FileName",            "Import keys and values from a .reg file" },
    { "flags"   .. flags,   " KeyName [query|set]", "Query or set flags for keys" },
}

clink.argmatcher("reg")
:_addexflags({
    { "/?",                 "Show help" },
})
:_addexarg(commands)
