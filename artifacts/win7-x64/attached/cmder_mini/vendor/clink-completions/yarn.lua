-- preamble: common routines

local JSON = require("JSON")

-- silence JSON parsing errors
function JSON:assert () end  -- luacheck: no unused args

local w = require('tables').wrap
local matchers = require('matchers')
local color = require('color')
local clink_version = require('clink_version')

---
 -- Queries config options value using 'yarn config get' call
 -- @param  {string}  config_entry  Config option name
 -- @return {string}  Config value for specific option or
 --   empty string in case of any error
---
local function get_yarn_config_value (config_entry)
    assert(config_entry and type(config_entry) == "string" and #config_entry > 0,
        "get_yarn_config_value: config_entry param should be non-empty string")

    local proc = io.popen("yarn config get "..config_entry.." 2>nul")
    if not proc then return "" end

    local value = proc:read()
    proc:close()

    return value or nil
end

local modules = matchers.create_dirs_matcher('node_modules/*')

local globals_location = nil
local global_modules_matcher = nil
local function global_modules(token)
    -- If we already have matcher then just return it
    if global_modules_matcher then return global_modules_matcher(token) end

    -- If token starts with . or .. or has path delimiter then return empty
    -- result and do not create a matcher so only fs paths will be completed
    if (token:match('^%.(%.)?') or token:match('[%\\%/]+')) then return {} end

    -- otherwise try to get cache location and return empty table if failed
    globals_location = globals_location or get_yarn_config_value("prefix")
    if not globals_location then return {} end

    -- Create a new matcher, save it in module's variable for further usage and return it
    global_modules_matcher = matchers.create_dirs_matcher(globals_location..'/node_modules/*')
    return global_modules_matcher(token)
end

--------------------------------------------------------------------------------
-- Let `yarn run` match files in bin folder (see #74 for why) and package.json
-- scripts.  When using newer versions of Clink, it is also able to colorize the
-- matches.

-- Reads package.json in current directory and extracts all "script" commands defined
local function package_scripts()
    -- Read package.json first
    local package_json = io.open('package.json')
    -- If there is no such file, then close handle and return
    if package_json == nil then return w() end

    -- Read the whole file contents
    local package_contents = package_json:read("*a")
    package_json:close()

    return JSON:decode(package_contents).scripts
end

local parser = clink.arg.new_parser

-- end preamble


local yarn_run_matches
local yarn_run_matches_parser
if not clink_version.supports_display_filter_description then
    yarn_run_matches = function ()
        local bins = w(matchers.create_files_matcher('node_modules/.bin/*.')(''))
        return bins:concat(w(package_scripts()):keys())
    end
    yarn_run_matches_parser = parser({yarn_run_matches})
else
    settings.add('color.yarn.module', 'bright green', 'Color for yarn run local module',
        'Used when Clink displays yarn run local module completions.')
    settings.add('color.yarn.script', 'bright blue', 'Color for yarn run project.json script',
        'Used when Clink displays yarn run project.json script completions.')

    yarn_run_matches = function ()
        local bin_matches = w(os.globfiles('node_modules/.bin/*.'))
        local bin_index = {}
        for _, m in ipairs(bin_matches) do
            bin_index[m] = true
        end
        bin_matches = bin_matches:map(function (m)
            return { match=m }
        end)

        local scripts = w(package_scripts())

        if clink_version.supports_query_rl_var and rl.isvariabletrue('colored-stats') then
            clink.ondisplaymatches(function (matches)
                local bc = color.get_clink_color('color.yarn.module')
                local sc = color.get_clink_color('color.yarn.script')
                return w(matches):map(function (match)
                    local m = match.match
                    if scripts[m] then
                        match.display = sc..m
                    elseif bin_index[m] then
                        match.display = bc..m
                    end
                    return match
                end)
            end)
        end

        return bin_matches:concat(scripts:keys())
    end

    yarn_run_matches_parser = clink.argmatcher():addarg({yarn_run_matches})
end


local add_parser = parser(
    "--dev", "-D",
    "--exact", "-E",
    "--optional", "-O",
    "--peer", "-P",
    "--tilde", "-T"
)

local yarn_parser = parser({
    "add"..add_parser,
    "bin",
    "cache"..parser({
        "clean",
        "dir",
        "ls"
    }),
    "check"..parser("--integrity"),
    "clean",
    "config"..parser({
        "delete",
        "get",
        "list",
        "set"
    }),
    "generate-lock-entry",
    "global"..parser({
        "add"..add_parser,
        "bin",
        "ls",
        "remove"..parser({modules}),
        "upgrade"..parser({modules})
    }),
    "help",
    "info",
    "init"..parser("--yes", "-y"),
    "install",
    "licenses"..parser({"generate-disclaimer", "ls"}),
    "link"..parser({matchers.files, global_modules}),
    "login",
    "logout",
    "ls"..parser("--depth"),
    "outdated"..parser({modules}),
    "owner"..parser({"add", "ls", "rm"}),
    "pack"..parser("--filename", "-f"),
    "publish"..parser(
        "--access"..parser({"public", "restricted"}),
        "--message",
        "--new-version",
        "--no-git-tag-version",
        "--tag"
    ),
    "remove"..parser({modules}),
    "run"..yarn_run_matches_parser,
    "self-update",
    "tag"..parser({"add", "ls", "rm"}),
    "team"..parser({"add", "create", "destroy", "ls", "rm"}),
    "test",
    "unlink"..parser({modules}),
    "upgrade"..parser({modules}, "--ignore-engines"),
    "upgrade-interactive",
    "version"..parser(
        "--message",
        "--new-version",
        "--no-git-tag-version"
    ),
    "versions",
    "why"..parser({modules}),
    yarn_run_matches,
    },
    "-h",
    "-v",
    "--cache-folder",
    "--flat",
    "--force",
    "--global-folder",
    "--har",
    "--help",
    "--https-proxy",
    "--ignore-engines",
    "--ignore-optional",
    "--ignore-platform",
    "--ignore-scripts",
    "--json",
    "--modules-folder",
    "--mutex",
    "--no-bin-links",
    "--no-lockfile",
    "--offline",
    "--no-emoji",
    "--no-progress",
    "--prefer-offline",
    "--proxy",
    "--pure-lockfile",
    "--prod",
    "--production",
    "--strict-semver",
    "--version"
)

clink.arg.register_parser("yarn", yarn_parser)
