--------------------------------------------------------------------------------
-- DIRX argmatcher for Clink.

--------------------------------------------------------------------------------
-- Helper functions.

local function args(...) -- luacheck: no unused
    return clink.argmatcher():addarg(...)
end

local function flags(...) -- luacheck: no unused
    return clink.argmatcher():addflags(...)
end

--------------------------------------------------------------------------------
-- Backward compatibility.

require('arghelper')

--------------------------------------------------------------------------------
-- Multi-character flags.

local mcf = require('multicharflags')

local attrs = mcf.addcharflagsarg(clink.argmatcher(), {
    { "r",          "Read-only files" },
    { "h",          "Hidden files" },
    { "s",          "System files" },
    { "a",          "Files ready for archiving" },
    { "d",          "Directories" },
    { "i",          "Not content indexed files" },
    { "j",          "Reparse points (mnemonic for junction)" },
    { "l",          "Reparse points (mnemonic for link)" },
    { "e",          "Encrypted files" },
    { "t",          "Temporary files" },
    { "p",          "Sparse files" },
    { "c",          "Compressed files" },
    { "o",          "Offline files" },
    { "+",          "Prefix meaning ANY" },
    { "-",          "Prefix meaning NOT" },
})

local quash = mcf.addcharflagsarg(clink.argmatcher(), {
    { "v",          "Suppress the volume information" },
    { "h",          "Suppress the header" },
    { "s",          "Suppress the summary" },
    { "-",          "Prefix to suppress next type (the default)" },
    { "+",          "Prefix to un-suppress next type" },
})

local skips = mcf.addcharflagsarg(clink.argmatcher(), {
    { "d",          "Skip hidden directories (when used with '-s')" },
    { "j",          "Skip junctions (when used with '-s')" },
    { "r",          "Skip files with no alternative data streams" },
    { "-",          "Prefix to skip next type (the default)" },
    { "+",          "Prefix to un-skip next type" },
})

local sorts = mcf.addcharflagsarg(clink.argmatcher(), {
    { "n",          "Name [and extension if 'e' not specified] (alphabetic)" },
    { "e",          "Extension (alphabetic)" },
    { "g",          "Group directories first" },
    { "d",          "Date/time (oldest first)" },
    { "s",          "Size (smallest first)" },
    { "c",          "Compression ratio" },
    { "a",          "Simple ASCII order (sort '10' before '2')" },
    { "u",          "Unsorted" },
    { "r",          "Reverse order for all options" },
    { "-",          "Prefix to reverse order" },
})

--------------------------------------------------------------------------------
-- Argument sub-parsers.

local helps = clink.argmatcher():_addexarg({
    { "colors",     "Help on color coding the file list" },
    { "colorsamples", "Display ANSI color codes" },
    { "defaultcolors", "Print the default color string" },
    { "icons",      "Help on icons and Nerd Fonts" },
    { "pictures",   "Help on format pictures" },
    { "regex",      "Help on regular expression syntax" },
})

local hexcode = clink.argmatcher():_addexarg({
    nosort=true,
    { "002e",       "'..' Two periods" },
    { "2026",       "'…' Ellipsis" },
    { "2192",       "'→' Right-pointing arrow" },
    { "25b8",       "'▸' Right-pointing triangle" },
    { "00bb",       "'»' Right-pointing chevron" },
})

local pictures = clink.argmatcher():_addexarg({
    fromhistory=true,
    { "PICTURE",    "Format picture (see '-? pictures')" },
})

local when = clink.argmatcher():addarg("always", "auto", "never")
local jwhen = clink.argmatcher():addarg({ nosort=true, "always", "fat", "normal", "never" })
local morec = clink.argmatcher():addarg({ fromhistory=true })
local cols = clink.argmatcher():addarg({ fromhistory=true, "80", "100", "120" })
local levels = clink.argmatcher():addarg({ fromhistory=true, 1, 2, 3, 4, 5 })
local globs = clink.argmatcher():addarg({ fromhistory=true })
local sizestyles = clink.argmatcher():addarg({
    nosort=true,
    "mini", "short", "normal",
})
local timestyles = clink.argmatcher():addarg({
    nosort=true,
    "locale", "mini", "iso", "compact", "short", "long-iso", "normal", "full", "relative",
})

--------------------------------------------------------------------------------
-- DIRX argmatcher.
-- luacheck: no max line length
local list_of_flags = {
    { "-?", helps, " [topic]",  "Display help text" },
    { "-V",                     "Display version information" },
    { "--version" },
    { "--nix" },            --  "Use Unix-y default options"
    { hide_unless="--nix", "--no-nix" },
    { "--debug" },
    { hide_unless="--debug", "--no-debug" },
    { hide=true, "--",          "" },

    -- Display options.
    { "-1",                     "Display one column per line" },
    { "-2",                     "Display two columns per line" },
    { "-4",                     "Display four columns per line" },
    { "-a",                     "Display all files (even hidden, etc)" },
    { "--all" },
    { "-b",                     "Bare mode; only display names" },
    { "--bare" },
    { hide_unless="/b -b --bare", "--no-bare" },
    { "-c",                     "Display with colors" },
    { "--color" },
    { hide_unless="/c -c --color", "--no-color" },
    { "-g",                     "Show git file status" },
    { "-gg",                    "Show git repo status" },
    { "--git" },
    { hide_unless="/g -g /gg -gg --git --git-repos", "--no-git" },
    { "--git-repos" },
    { hide_unless="/g -g /gg -gg --git --git-repos", "--no-git-repos" },
    { "-G",                     "Synonym for --wide" },
    { "--grid" },
    { hide_unless="/G -G /w -w --grid --wide --nix", "--no-grid" },
    { "-i",                     "Display file icons" },
    { "--icons" },
    { "--icons=", when, "when", "" },
    { hide_unless="/i -i --icons", "--no-icons" },
    { "-k",                     "Highlight with color scale" },
    { "--color-scale" },
    { opteq=true, "--color-scale=", args("all", "size", "time"), "which", "" },
    { hide_unless="/k -k --color-scale", "--no-color-scale" },
    { "-l",                     "Long mode; one file per line" },
    { "--long" },
    { hide_unless="/l -l --long", "--no-long" },
    { "-n",                     "Use normal list format" },
    { "-p",                     "Paginate output" },
    { "-Q",                     "Reset quashed output types" },
    { "-Q:", quash, "types",    "Quash output types" },
    { opteq=true, "--quash=", quash, "types", "" },
    { "-R",                     "Synonym for --recurse" },
    { "-s",                     "Subdirectories; recursively list files" },
    { "--recurse" },
    { "-u",                     "Usage mode; directory size info" },
    { "--usage" },
    { "-v",                     "Sort columns vertically" },
    { "--vertical" },
    { "--horizontal" },
    { "-w",                     "Wide list mode" },
    { "--wide" },
    { hide_unless="/w -w /G -G --wide --grid --nix", "--no-wide" },
    { "-z",                     "Use FAT list format" },
    { "--fat" },
    { hide_unless="/z -z --fat", "--no-fat" },
    { opteq=true, "--color-scale-mode=", args("fixed", "gradient"), "mode", "" },
    { "--hyperlinks" },
    { hide_unless="--hyperlinks", "--no-hyperlinks" },
    { "--tree" },
    { hide_unless="--tree", "--no-tree" },

    -- Filtering and sorting options.
    { "-a:", attrs, "attrs",    "Filter files by attributes" },
    { "-A",                     "Display all files, except hide . and .." },
    { "--almost-all" },
    { "-h",                     "Hide . and .. directories" },
    { "-I", globs, " glob",     "Glob patterns of files to ignore" },
    { "--ignore-glob=", globs, "glob", "" },
    { "-L", levels, " depth",   "Limit depth of recursion with -s" },
    { opteq=true, "--levels=", levels, "depth", "" },
    { hide=true, opteq=true, "--level=", levels, "depth", "" },
    { "-o:", sorts, "options",  "List files in sorted order" },
    { "-X",                     "Reset skipped types" },
    { "-X:", skips, "types",    "Skip types during -s" },
    { opteq=true, "--skip=", skips, "types", "" },
    { "--git-ignore" },
    { hide_unless="--git-ignore", "--no-git-ignore" },
    { "--hide-dot-files" },
    { hide_unless="--hide-dot-files --nix", "--no-hide-dot-files" },
    { "--reverse" },
    { hide_unless="--reverse", "--no-reverse" },
    { "--string-sort" },
    { "--word-sort" },

    -- Field options.
    { "-C",                     "Display compression ratio" },
    { "--ratio" },
    { hide_unless="/C -C --ratio", "--no-ratio" },
    { "-q",                     "Display owner of the file" },
    { "--owner" },
    { hide_unless="/q -q --owner", "--no-owner" },
    { "-r",                     "Display alternate data streams" },
    { hide=true, "-:",          "" },
    { "--streams" },
    { hide_unless="/r -r /: -: --streams", "--no-streams" },
    { "-S",                     "List file size in wide modes" },
    { "--size" },
    { hide_unless="/f -f --size /S -S /Sa -Sa /Sc -Sc /Sf -Sf /SS -SS /z -z --fat /Z -Z /l -l --long", "--no-size" },
    { "-Sa",                    "Use the Allocation size" },
    { "-Sc",                    "Use the Compressed size" },
    { "-Sf",                    "Use the File size (default)" },
    { "-t",                     "Display file attributes" },
    { "--attributes" },
    { hide_unless="/t -t --attributes --nix", "--no-attributes" },
    { "-T",                     "List file time in wide modes" },
    { "--time" },
    { hide_unless="/f -f --time /T -T /Ta -Ta /Tc -Tc /Tw -Tw /TT -TT /z -z --fat /Y -Y /l -l --long", "--no-time" },
    { "-Ta",                    "Use the Access time" },
    { "-Tc",                    "Use the Creation time" },
    { "-Tw",                    "Use the Write time (default)" },
    { "-x",                     "Display 8.3 short file names" },
    { "--short-names" },
    { hide_unless="/x -x --short-names", "--no-short-names" },

    -- Formatting options.
    { "-,",                     "Show thousands separator (default)" },
    { "-f", pictures, " picture", "Specify format picture" },
    { "-F",                     "Show full file paths" },
    { "--full-paths" },
    { "-j",                     "Justify names in FAT list format" },
    { "-J",                     "Justify names in non-FAT list format" },
    { "--justify" },
    { "--justify=", jwhen, "when", "" },
    { "--lower" },
    { "-SS",                    "Show long file sizes" },
    { "-TT",                    "Show long dates and times" },
    { "-W", cols, " cols",      "Override screen width" },
    { opteq=true, "--width=", cols, "cols", "" },
    { "-Y",                     "Abbreviate times" },
    { "-Z",                     "Abbreviate file sizes" },
    { "--bare-relative" },
    { hide_unless="--bare-relative", "--no-bare-relative" },
    { "--classify" },
    { hide_unless="--classify", "--no-classify" },
    { "--compact" },
    { hide_unless="--compact", "--no-compact" },
    { "--escape-codes" },
    { "--escape-codes=", when, "when", "" },
    { hide_unless="--no-fit-columns", "--fit-columns" },
    { "--no-fit-columns" },
    { "--mini-bytes" },
    { hide_unless="--mini-bytes", "--no-mini-bytes" },
    { "--mini-header" },
    { hide_unless="--mini-header --nix", "--no-mini-header" },
    { "--more-colors=", morec, "list", "" },
    { opteq=true, "--nerd-fonts=", args("2", "3"), "ver", "" },
    { opteq=true, "--pad-icons=", args("1", "2", "3", "4"), "spaces", "" },
    { "--relative" },
    { hide_unless="--relative", "--no-relative" },
    { opteq=true, "--size-style=", sizestyles, "style", "" },
    { opteq=true, "--time-style=", timestyles, "style", "" },
    { opteq=true, "--truncate-char=", hexcode, "hexchar", "" },
    { "--utf8" },
    { hide_unless="--utf8", "--no-utf8" },

    { hide=true, "-,-",         "" },
    { hide=true, "-a-",         "" },
    { hide=true, "-b-",         "" },
    { hide=true, "-c-",         "" },
    { hide=true, "-C-",         "" },
    { hide=true, "-F-",         "" },
    { hide=true, "-h-",         "" },
    { hide=true, "-i-",         "" },
    { hide=true, "-j-",         "" },
    { hide=true, "-J-",         "" },
    { hide=true, "-k-",         "" },
    { hide=true, "-K-",         "" },
    { hide=true, "-l-",         "" },
    { hide=true, "-n-",         "" },
    { hide=true, "-p-",         "" },
    { hide=true, "-q-",         "" },
    { hide=true, "-r-",         "" },
    { hide=true, "-s-",         "" },
    { hide=true, "-S-",         "" },
    { hide=true, "-t-",         "" },
    { hide=true, "-T-",         "" },
    { hide=true, "-u-",         "" },
    { hide=true, "-v-",         "" },
    { hide=true, "-w-",         "" },
    { hide=true, "-x-",         "" },
    { hide=true, "-Y-",         "" },
    { hide=true, "-z-",         "" },
    { hide=true, "-Z-",         "" },
}

local function onarg_dirxcmd(arg_index, word, word_index, line_state, user_data) -- luacheck: no unused
    if arg_index == 0 and not user_data.done_dirxcmd then
        user_data.done_dirxcmd = true
        user_data.present = user_data.present or {} -- Cooperates with arghelper.lua!
        for _,w in ipairs(string.explode(os.getenv("DIRXCMD") or "")) do
            user_data.present[w] = true
        end
    end
end

-- IMPORTANT: If slash_flags has an onarg callback, then it will replace the one
-- from minus_flags, which would mess up both the DIRXCMD processing and also
-- the hide_unless stuff in general.
local minus_flags = { onarg=onarg_dirxcmd }
local slash_flags = {}

local function copy_vars(entry, tbl)
    tbl.hide = entry.hide
    tbl.hide_unless = entry.hide_unless
    tbl.opteq = entry.opteq
    return tbl
end

for _, entry in ipairs(list_of_flags) do
    local minus = entry[1]
    local slash = entry[1]:gsub("^%-", "/")
    local long = entry[1]:find("^%-%-") and true

    local num = #entry
    if num == 2 or num == 3 then
        table.insert(minus_flags, copy_vars(entry, { minus, entry[2] }))
        table.insert(slash_flags, copy_vars(entry, { slash, entry[2] }))
    elseif num == 4 or long then
        if entry[2] then
            table.insert(minus_flags, copy_vars(entry, { minus..entry[2], entry[3], entry[4] }))
        else
            table.insert(minus_flags, copy_vars(entry, { minus, entry[3], entry[4] }))
        end
        if not long then
            table.insert(slash_flags, copy_vars(entry, { slash..entry[2], entry[3], entry[4] }))
        end
    else
        error("unrecognized flag entry format.")
    end
end

clink.argmatcher("dirx")
:_addexflags(minus_flags)
:_addexflags(slash_flags)
