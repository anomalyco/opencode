require('arghelper')

local dir_matcher = clink.argmatcher():addarg(clink.dirmatches)
local file_matcher = clink.argmatcher():addarg({
    { match="/", display="/ (console)" },
    clink.filematches
})

-- luacheck: no max line length
clink.argmatcher("findstr")
:_addexflags({
    {"/b",          "Matches pattern if at the beginning of a line"},
    {"/e",          "Matches pattern if at the end of a line"},
    {"/l",          "Uses search strings literally"},
    {"/r",          "Uses search strings as regular expressions (default)"},
    {"/s",          "Search in subdirectories also"},
    {"/i",          "Case insensitive search"},
    {"/x",          "Prints lines that match exactly"},
    {"/v",          "Prints only lines that do not contain a match"},
    {"/n",          "Prints the line number before each line that matches"},
    {"/m",          "Prints only the filename if a file contains a match"},
    {"/o",          "Prints character offset before each matching line"},
    {"/p",          "Skips files with non-printable characters"},
    {"/offline",    "Do not skip files with offline attribute set"},
    {"/a:"..clink.argmatcher():addarg({fromhistory=true, "attr"}), "hexattr", "Specifies color attribute with two hex digits"},
    {"/f:"..file_matcher, "file", "Reads file list from the specified file (/ stands for console)"},
    {"/c:"..clink.argmatcher():addarg("search_string"), "string", "Uses specified string as literal search string"},
    {"/g:"..file_matcher, "file", "Gets search strings from the specified file (/ stands for console)"},
    {"/d:"..dir_matcher, "dir[;dir...]", "Search a semicolon delimited list of directories"},
})
