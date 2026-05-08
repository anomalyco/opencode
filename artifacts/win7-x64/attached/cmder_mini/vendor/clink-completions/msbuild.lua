--------------------------------------------------------------------------------
-- Usage:
--
-- This builds an argmatcher for MSBUILD.
--
-- It also defines a global msbuild_parser_data table which contains two tables
-- that other scripts can use to add MSBUILD flags to their own argmatchers:
--
--  msbuild_parser_data.exflags
--  msbuild_parser_data.hideflags
--      Table of flags for :_addexflags() and :hideflags(), to add all flag
--      forms (/, -, --) and hide short form flags and all -- flags.
--
--  msbuild_parser_data.exflags_onlyslash
--  msbuild_parser_data.hideflags_onlyslash
--      Table of flags for :_addexflags() and :hideflags(), to add only / flags
--      and hide short form flags.
--
--  msbuild_parser_data.exflags_onlyminus
--  msbuild_parser_data.hideflags_onlyminus
--      Table of flags for :_addexflags() and :hideflags(), to add only - flags
--      and hide short form flags.
--
--  msbuild_parser_data.exflags_onlyminusminus
--  msbuild_parser_data.hideflags_onlyminusminus
--      Table of flags for :_addexflags() and :hideflags(), to add only -- flags
--      and hide short form flags.
--
-- Because of the global msbuild_parser_data table, this script should be
-- located in a normal script directory, not in a completions subdirectory.

local clink_version = require('clink_version')
if not clink_version.new_api then
    return
end

--[[
// vim: set et:
--]]
require('arghelper')

-- luacheck: no max line length

-- This is a global so that other scripts can add the tables into their own
-- argmatchers, e.g. for use with scripts that wrap msbuild with additional
-- functionality.

-- luacheck: globals msbuild_parser_data
msbuild_parser_data = {}

local binlog = clink.argmatcher():addarg({ fromhistory=true })
local codes = clink.argmatcher():addarg({ fromhistory=true })
local clparams = clink.argmatcher():_addexarg({
    { 'PerformanceSummary', 'Show time spent in tasks, targets and projects' },
    { 'Summary', 'Show error and warning summary at the end' },
    { 'NoSummary', 'Don\'t show error and warning summary at the end' },
    { 'ErrorsOnly', 'Show only errors' },
    { 'WarningsOnly', 'Show only warnings' },
    { 'NoItemAndPropertyList', 'Don\'t show list of items and properties at the start of each project build' },
    { 'ShowCommandLine', 'Show TaskCommandLineEvent message' },
    { 'ShowTimestamp', 'Display the Timestamp as a prefix to any message' },
    { 'ShowEventId', 'Show eventId for started events, finished events, and message' },
    { 'ForceNoAlign', 'Does not align the text to the size of the console buffe' },
    { 'DisableConsoleColor', 'Use the default console colors for all logging messages' },
    { 'DisableMPLogging', ' Disable the multiprocessor logging style of output when running in non-multiprocessor mode' },
    { 'EnableMPLogging', 'Enable the multiprocessor logging style even when running in non-multiprocessor mode. This logging style is on by default' },
    { 'ForceConsoleColor', 'Use ANSI console colors even if console does not support i' },
    { 'Verbosity', 'overrides the -verbosity setting for this logger' },
})
local cpus = clink.argmatcher():addarg({ fromhistory=true, '2', '3', '4', '6', '8', '10' })
local dlparams = clink.argmatcher():addarg({ fromhistory=true })
local flparams = clink.argmatcher():addarg({ fromhistory=true })
local exts = clink.argmatcher():addarg({ fromhistory=true })
local filelist = clink.argmatcher():addarg(clink.filematches)
local files = clink.argmatcher():addarg(clink.filematches)
local logger = clink.argmatcher():addarg({ fromhistory=true })
local neqv = clink.argmatcher():addarg({ fromhistory=true })
local schema = clink.argmatcher():addarg({ fromhistory=true })
local targets = clink.argmatcher():addarg({ fromhistory=true, "clean" })
local tf = clink.argmatcher():addarg({ 'true', 'false' })
local tver = clink.argmatcher():addarg({ fromhistory=true })
local vlevel = clink.argmatcher():addarg({
    'q', 'm', 'n', 'd', 'diag',
    'quiet', 'minimal', 'normal', 'detailed', 'diagnostic',
}):hideflags({
    'q', 'm', 'n', 'd', 'diag',
})

local displays = {
    [binlog] = 'params',
    [codes] = 'code[;...]',
    [clparams] = 'params',
    [cpus] = 'num',
    [dlparams] = 'params',
    [flparams] = 'params',
    [exts] = '.ext[;...]',
    [filelist] = 'file[;...]',
    [files] = 'file',
    [logger] = 'logger',
    [neqv] = 'n=v[;...]',
    [schema] = 'schema',
    [targets] = 'target[;...]',
    [tf] = 'True|False',
    [tver] = 'version',
    [vlevel] = 'level',
}

local source = {
    { { 't:', 'target:', targets },                     'Build these targets in this project' },
    { { 'p:', 'property:', neqv },                      'Set or override these project-level properties' },
    { { 'm', 'maxCpuCount' },                           'Build with concurrent processes, up to the number of processors on the computer' },
    { { 'm:', 'maxCpuCount:', cpus },                   'Specify the maximum number of concurrent processes to build with' },
    { { 'tv:', 'toolsVersion:', tver },                 'Override version of the MSBuild toolset to use during build' },
    { { 'v:', 'verbosity:', vlevel },                   'Display this amount of information to the event log' },
    { { 'clp:', 'consoleLoggerParameters:', clparams }, 'Parameters to console logger' },
    { { 'noConLog', 'noConsoleLogger' },                'Disable the default console logger and do not log events to the console' },
    { { 'fl1', 'fileLogger1',
        'fl2', 'fileLogger2',
        'fl3', 'fileLogger3',
        'fl4', 'fileLogger4',
        'fl5', 'fileLogger5',
        'fl6', 'fileLogger6',
        'fl7', 'fileLogger7',
        'fl8', 'fileLogger8',
        'fl9', 'fileLogger9',
        'fl', 'fileLogger' },                           'Logs the build output to a file' },
    { { 'flp1', 'fileLoggerParameters1',
        'flp2', 'fileLoggerParameters2',
        'flp3', 'fileLoggerParameters3',
        'flp4', 'fileLoggerParameters4',
        'flp5', 'fileLoggerParameters5',
        'flp6', 'fileLoggerParameters6',
        'flp7', 'fileLoggerParameters7',
        'flp8', 'fileLoggerParameters8',
        'flp9', 'fileLoggerParameters9',
        'flp', 'fileLoggerParameters', flparams },      'Provide extra parameters for file loggers' },
    { { 'dl:', 'distributedLogger:', dlparams },        'Use this logger(s) to log events from MSBuild, one instance per node' },
    { { 'distributedFileLogger' },                      'Log build output to one log file per MSBuild node' },
    { { 'l:', 'logger:', logger },                      'Use this logger(s) to log events from MSBuild' },
    { { 'bl', 'binaryLogger' },                         'Use a compressed binary log file (see https://aka.ms/msbuild/binlog)' },
    { { 'bl:', 'binaryLogger:', binlog },               'Use a compressed binary log file (see https://aka.ms/msbuild/binlog)' },
    { { 'err', 'warnAsError' },                         'Treat warning codes as errors' },
    { { 'err:', 'warnAsError:', codes },                'List of warning codes to treat as errors' },
    { { 'noWarn', 'warnAsMessage' },                    'Treat warning codes as low importance messages' },
    { { 'noWarn:', 'warnAsMessage:', codes },           'List of warning codes to treat as low importance messages' },
    { { 'val', 'validate' },                            'Validate the project against the default schema' },
    { { 'val:', 'validate:', schema },                  'Validate the project against the specified schema (e.g. xsd file)' },
    { { 'ignore:', 'ignoreProjectExtensions:', exts },  'List of extensions to ignore when determining which project file to build' },
    { { 'nr:', 'nodeReuse:', tf },                      'Enable or disable the reuse of MSBuild nodes after the build completes' },
    { { 'pp', 'preprocess' },                           'Write to stdout an aggregated project file by inlining all the files that would be imported, with their boundaries marked' },
    { { 'pp:', 'preprocess:', files },                  'Write an aggregated project file by inlining all the files that would be imported, with their boundaries marked' },
    { { 'ts', 'targets' },                              'List the available targets without executing the actual build process' },
    { { 'ts:', 'targets:', files },                     'Write to the specified file a list of available targets without executing the actual build process' },
    { { 'ds', 'detailedSummary' },                      'Show detailed information at the end of the build' },
    { { 'ds:', 'detailedSummary:', tf },                'Indicates whether to show detailed information at the end of the build' },
    { { 'r', 'restore' },                               'Runs a target named Restore prior to building other targets and uses the latest restored build logic for them' },
    { { 'r:', 'restore:', tf },                         'Indicates whether to run a target named Restore prior to building other targets and uses the latest restored build logic for them' },
    { { 'rp:', 'restoreProperty:', neqv },              'Set or overide project-level properties only during restore and do not use properties specified with -property' },
    { { 'profileEvaluation:', files },                  'Profiles MSBuild evaluation and writes the result to the specified file (.md ext for markdown format)' },
    { { 'interactive' },                                'Actions in the build are allowed to interact with the user' },
    { { 'interactive:', tf },                           'Indicates whether actions in the build are allowed to interact with the user' },
    { { 'isolate', 'isolateProjects' },                 'Build each project in isolation' },
    { { 'isolate:', 'isolateProjects:', tf },           'Indicates whether to build each project in isolation' },
    { { 'irc:', 'inputResultsCaches:', filelist },      'Semicolon separated list of input cache files that MSBuild will read build results from' },
    { { 'orc:', 'outputResultsCache:', files },         'Output cache file where MSBuild will write the contents of its build result caches at the end of the build' },
    { { 'graph', 'graphBuild' },                        'Construct and build a project graph' },
    { { 'graph:', 'graphBuild:', tf },                  'Indicates whether to construct and build a project graph' },
    { { 'low', 'lowPriority' },                         'Causes MSBuild to run at low process priority' },
    { { 'low:', 'lowPriority:', tf },                   'True or False causes MSBuild to run at low process priority or not' },
    { { 'noAutoRsp', 'noAutoResponse' },                'Do not auto-include any MSBuild.rsp files' },
    { { 'noLogo' },                                     'Do not display the startup banner and copyright message' },
    { { 'ver', 'version' },                             'Display version information only' },
    { { 'h', 'help' },                                  'Display help' },
    { { '?' },                                          'Display help' },
}

msbuild_parser_data.exflags = {}
msbuild_parser_data.exflags_onlyslash = {}
msbuild_parser_data.exflags_onlyminus = {}
msbuild_parser_data.exflags_onlyminusminus = {}
msbuild_parser_data.hideflags = {}
msbuild_parser_data.hideflags_onlyslash = {}
msbuild_parser_data.hideflags_onlyminus = {}
msbuild_parser_data.hideflags_onlyminusminus = {}

local function make_exflag(flag, linked, desc)
    local exflag = {}

    -- Flag.
    if flag:sub(-1) ~= ':' then
        linked = nil
    end
    table.insert(exflag, linked and flag..linked or flag)

    -- Arg info.
    local display = linked and displays[linked]
    if display then
        desc = desc or ''
        table.insert(exflag, display)
    end

    -- Description.
    if desc then
        table.insert(exflag, desc)
    end

    return exflag
end

for _,e in ipairs(source) do
    local flags = e[1]
    local desc = e[2]

    local num = #flags
    local linked = type(flags[num]) == 'table' and flags[num]
    if linked then
        num = num - 1
    end

    local hidenum = num - 1
    for i = 1, hidenum do
        table.insert(msbuild_parser_data.hideflags, '/'..flags[i])
        table.insert(msbuild_parser_data.hideflags_onlyslash, '/'..flags[i])
        table.insert(msbuild_parser_data.hideflags, '-'..flags[i])
        table.insert(msbuild_parser_data.hideflags_onlyminus, '-'..flags[i])
        table.insert(msbuild_parser_data.hideflags, '--'..flags[i])
        table.insert(msbuild_parser_data.hideflags_onlyminusminus, '--'..flags[i])
    end
    table.insert(msbuild_parser_data.hideflags, '--'..flags[num])

    local exflag
    for i = 1, num do
        exflag = make_exflag('/'..flags[i], linked, desc)
        table.insert(msbuild_parser_data.exflags, exflag)
        table.insert(msbuild_parser_data.exflags_onlyslash, exflag)
        exflag = make_exflag('-'..flags[i], linked, desc)
        table.insert(msbuild_parser_data.exflags, exflag)
        table.insert(msbuild_parser_data.exflags_onlyminus, exflag)
        exflag = make_exflag('--'..flags[i], linked, desc)
        table.insert(msbuild_parser_data.exflags, exflag)
        table.insert(msbuild_parser_data.exflags_onlyminusminus, exflag)
    end
end

clink.argmatcher('msbuild')
:_addexflags(msbuild_parser_data.exflags)
:hideflags(msbuild_parser_data.hideflags)
