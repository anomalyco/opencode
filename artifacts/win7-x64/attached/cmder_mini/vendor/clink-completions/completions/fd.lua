------------------------------------------------------------------------------
-- FD

-- luacheck: no max line length

local function try_require(module)
  local r
  pcall(function() r = require(module) end)
  return r
end

try_require("arghelper")

local fd_and = clink.argmatcher():addarg({})
local fd_basedirectory = clink.argmatcher():addarg({})
local fd_batchsize = clink.argmatcher():addarg({})
local fd_changedbefore = clink.argmatcher():addarg({})
local fd_changedwithin = clink.argmatcher():addarg({})
local fd_color = clink.argmatcher():addarg({"auto", "always", "never"}):adddescriptions({
  ["auto"] = "show colors if the output goes to an interactive console (default)",
  ["always"] = "always use colorized output",
  ["never"] = "do not use colorized output",
})
local fd_exactdepth = clink.argmatcher():addarg({})
local fd_exclude = clink.argmatcher():addarg({})
local fd_exec = clink.argmatcher():addarg({})
local fd_execbatch = clink.argmatcher():addarg({})
local fd_extension = clink.argmatcher():addarg({})
local fd_gencompletions = clink.argmatcher():addarg({"bash", "elvish", "fish", "powershell", "zsh"})
local fd_ignorefile = clink.argmatcher():addarg({})
local fd_maxbuffertime = clink.argmatcher():addarg({})
local fd_maxdepth = clink.argmatcher():addarg({})
local fd_maxresults = clink.argmatcher():addarg({})
local fd_mindepth = clink.argmatcher():addarg({})
local fd_pathseparator = clink.argmatcher():addarg({})
local fd_searchpath = clink.argmatcher():addarg({})
local fd_size = clink.argmatcher():addarg({})
local fd_threads = clink.argmatcher():addarg({})
local fd_type = clink.argmatcher():addarg({"file", "directory", "symlink", "block-device", "char-device", "executable", "empty", "socket", "pipe"}):adddescriptions({
  ["executable"] = "A file which is executable by the current effective user",
})

clink.argmatcher("fd")
:adddescriptions({
  ["--absolute-path"] = { "Show absolute instead of relative paths" },
  ["--and"] = { " arg", "Additional search patterns that need to be matched" },
  ["--base-directory"] = { " arg", "Change current working directory" },
  ["--batch-size"] = { " arg", "Max number of arguments to run as a batch size with -X" },
  ["--case-sensitive"] = { "Case-sensitive search (default: smart case)" },
  ["--changed-before"] = { " arg", "Filter by file modification time (older than)" },
  ["--changed-within"] = { " arg", "Filter by file modification time (newer than)" },
  ["--color"] = { " arg", "When to use colors" },
  ["--exact-depth"] = { " arg", "Only show search results at the exact given depth" },
  ["--exclude"] = { " arg", "Exclude entries that match the given glob pattern" },
  ["--exec"] = { " arg", "Execute a command for each search result" },
  ["--exec-batch"] = { " arg", "Execute a command with all search results at once" },
  ["--extension"] = { " arg", "Filter by file extension" },
  ["--fixed-strings"] = { "Treat pattern as literal string stead of regex" },
  ["--follow"] = { "Follow symbolic links" },
  ["--full-path"] = { "Search full abs. path (default: filename only)" },
  ["--gen-completions"] = { " arg", "" },
  ["--glob"] = { "Glob-based search (default: regular expression)" },
  ["--help"] = { "Print help (see more with '--help')" },
  ["--hidden"] = { "Search hidden files and directories" },
  ["--ignore"] = { "Overrides --no-ignore" },
  ["--ignore-case"] = { "Case-insensitive search (default: smart case)" },
  ["--ignore-file"] = { " arg", "Add a custom ignore-file in '.gitignore' format" },
  ["--ignore-vcs"] = { "Overrides --no-ignore-vcs" },
  ["--list-details"] = { "Use a long listing format with file metadata" },
  ["--max-buffer-time"] = { " arg", "Milliseconds to buffer before streaming search results to console" },
  ["--max-depth"] = { " arg", "Set maximum search depth (default: none)" },
  ["--max-results"] = { " arg", "Limit the number of search results" },
  ["--min-depth"] = { " arg", "Only show search results starting at the given depth." },
  ["--no-follow"] = { "Overrides --follow" },
  ["--no-global-ignore-file"] = { "Do not respect the global ignore file" },
  ["--no-hidden"] = { "Overrides --hidden" },
  ["--no-ignore"] = { "Do not respect .(git|fd)ignore files" },
  ["--no-ignore-parent"] = { "Do not respect .(git|fd)ignore files in parent directories" },
  ["--no-ignore-vcs"] = { "Do not respect .gitignore files" },
  ["--no-require-git"] = { "Do not require a git repository to respect gitignores. By default, fd will only respect global gitignore rules, .gitignore rules, and local exclude rules if fd detects that you are searching inside a git repository. This flag allows you to relax this restriction such that fd will respect all git related ignore rules regardless of whether you're searching in a git repository or not" },
  ["--one-file-system"] = { "By default, fd will traverse the file system tree as far as other options dictate. With this flag, fd ensures that it does not descend into a different file system than the one it started in. Comparable to the -mount or -xdev filters of find(1)" },
  ["--path-separator"] = { " arg", "Set path separator when printing file paths" },
  ["--print0"] = { "Separate search results by the null character" },
  ["--prune"] = { "Do not traverse into directories that match the search criteria. If you want to exclude specific directories, use the '--exclude=…' option" },
  ["--quiet"] = { "Print nothing, exit code 0 if match found, 1 otherwise" },
  ["--regex"] = { "Regular-expression based search (default)" },
  ["--relative-path"] = { "Overrides --absolute-path" },
  ["--require-git"] = { "Overrides --no-require-git" },
  ["--search-path"] = { " arg", "Provides paths to search as an alternative to the positional <path> argument" },
  ["--show-errors"] = { "Show filesystem errors" },
  ["--size"] = { " arg", "Limit results based on the size of files" },
  ["--strip-cwd-prefix"] = { "By default, relative paths are prefixed with './' when -x/--exec, -X/--exec-batch, or -0/--print0 are given, to reduce the risk of a path starting with '-' being treated as a command line option. Use this flag to disable this behaviour" },
  ["--threads"] = { " arg", "Set number of threads to use for searching & executing (default: number of available CPU cores)" },
  ["--type"] = { " arg", "Filter by type: file (f), directory (d), symlink (l), executable (x), empty (e), socket (s), pipe (p), char-device (c), block-device (b)" },
  ["--unrestricted"] = { "Unrestricted search, alias for '--no-ignore --hidden'" },
  ["--version"] = { "Print version" },
  ["-0"] = { "Separate search results by the null character" },
  ["-1"] = { "Limit search to a single result" },
  ["-a"] = { "Show absolute instead of relative paths" },
  ["-c"] = { " arg", "When to use colors" },
  ["-d"] = { " arg", "Set maximum search depth (default: none)" },
  ["-e"] = { " arg", "Filter by file extension" },
  ["-E"] = { " arg", "Exclude entries that match the given glob pattern" },
  ["-F"] = { "Treat pattern as literal string stead of regex" },
  ["-g"] = { "Glob-based search (default: regular expression)" },
  ["-h"] = { "Print help (see more with '--help')" },
  ["-H"] = { "Search hidden files and directories" },
  ["-i"] = { "Case-insensitive search (default: smart case)" },
  ["-I"] = { "Do not respect .(git|fd)ignore files" },
  ["-j"] = { " arg", "Set number of threads to use for searching & executing (default: number of available CPU cores)" },
  ["-l"] = { "Use a long listing format with file metadata" },
  ["-L"] = { "Follow symbolic links" },
  ["-p"] = { "Search full abs. path (default: filename only)" },
  ["-q"] = { "Print nothing, exit code 0 if match found, 1 otherwise" },
  ["-s"] = { "Case-sensitive search (default: smart case)" },
  ["-S"] = { " arg", "Limit results based on the size of files" },
  ["-t"] = { " arg", "Filter by type: file (f), directory (d), symlink (l), executable (x), empty (e), socket (s), pipe (p), char-device (c), block-device (b)" },
  ["-u"] = { "Unrestricted search, alias for '--no-ignore --hidden'" },
  ["-V"] = { "Print version" },
  ["-x"] = { " arg", "Execute a command for each search result" },
  ["-X"] = { " arg", "Execute a command with all search results at once" },
})
:addflags({
  "--and"..fd_and,
  "-d"..fd_maxdepth,
  "--max-depth"..fd_maxdepth,
  "--min-depth"..fd_mindepth,
  "--exact-depth"..fd_exactdepth,
  "-E"..fd_exclude,
  "--exclude"..fd_exclude,
  "-t"..fd_type,
  "--type"..fd_type,
  "-e"..fd_extension,
  "--extension"..fd_extension,
  "-S"..fd_size,
  "--size"..fd_size,
  "--changed-within"..fd_changedwithin,
  "--changed-before"..fd_changedbefore,
  "-x"..fd_exec,
  "--exec"..fd_exec,
  "-X"..fd_execbatch,
  "--exec-batch"..fd_execbatch,
  "--batch-size"..fd_batchsize,
  "--ignore-file"..fd_ignorefile,
  "-c"..fd_color,
  "--color"..fd_color,
  "-j"..fd_threads,
  "--threads"..fd_threads,
  "--max-buffer-time"..fd_maxbuffertime,
  "--max-results"..fd_maxresults,
  "--base-directory"..fd_basedirectory,
  "--path-separator"..fd_pathseparator,
  "--search-path"..fd_searchpath,
  "--gen-completions"..fd_gencompletions,
  "-H",
  "--hidden",
  "--no-hidden",
  "-I",
  "--no-ignore",
  "--ignore",
  "--no-ignore-vcs",
  "--ignore-vcs",
  "--no-require-git",
  "--require-git",
  "--no-ignore-parent",
  "--no-global-ignore-file",
  "-u",
  "--unrestricted",
  "-s",
  "--case-sensitive",
  "-i",
  "--ignore-case",
  "-g",
  "--glob",
  "--regex",
  "-F",
  "--fixed-strings",
  "-a",
  "--absolute-path",
  "--relative-path",
  "-l",
  "--list-details",
  "-L",
  "--follow",
  "--no-follow",
  "-p",
  "--full-path",
  "-0",
  "--print0",
  "--prune",
  "-1",
  "-q",
  "--quiet",
  "--show-errors",
  "--strip-cwd-prefix",
  "--one-file-system",
  "-h",
  "--help",
  "-V",
  "--version",
})
