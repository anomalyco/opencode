-- -*- coding: utf-8 -*-
-- preamble: common routines

local matchers = require("matchers")
local w = require("tables").wrap
local concat = require("funclib").concat

local parser = clink.arg.new_parser

local function pipenv_libs_list(token)
    local handle = io.popen('python -c "import sys; print(\\";\\".join(sys.path))"')
    local result = handle:read("*a")
    handle:close()

    -- trim spaces
    result = clink.get_cwd() .. result:gsub("^%s*(.-)%s*$", "%1")

    local lib_paths = clink.split(result, ";")

    local list = w()
    for lib_path in lib_paths do
        local finder = matchers.create_files_matcher(lib_path)
        local libs = finder(token)
        libs =
            libs:filter(
            function(v)
                return clink.is_dir(lib_path .. "/" .. v) or string.find(v, "%.py$")
            end
        )

        list = w(concat(list, libs))
    end

    -- remove ".py" and "-1.2.3-dist-info" of file name
    for k, v in pairs(list) do
        list[k] = v:gsub(".py", ""):gsub("-[%d%.]+dist%-info$", "")
    end

    return list
end

local pipenv_default_flags = {
    "--python",
    "--three",
    "--two",
    "--clear",
    "--verbose",
    "-v",
    "--pypi-mirror",
    "--help",
    "-h"
}

local pipenv_check_parser = parser():add_flags(pipenv_default_flags, "--unused", "--ignore", "-i", "--system"):loop(1)

local pipenv_clean_parser = parser():add_flags(pipenv_default_flags, "--bare", "--dry-run")

local pipenv_graph_parser = parser():add_flags(pipenv_default_flags, "--bare", "--json", "--json-tree", "--reverse")

local pipenv_install_parser =
    parser():add_flags(
    pipenv_default_flags,
    "--system",
    "--code",
    "-c",
    "--deploy",
    "--skip-lock",
    "--editable",
    "-e",
    "--ignore-pipfile",
    "--selective-upgrade",
    "--pre",
    "--requirements" .. parser({clink.matches_are_files}),
    "-r" .. parser({clink.matches_are_files}),
    "--extra-index-url",
    "--index",
    "-i",
    "--sequential",
    "--keep-outdated",
    "--dev",
    "-d"
):loop(1)

local pipenv_lock_parser =
    parser():add_flags(pipenv_default_flags, "--requirements", "-r", "--keep-outdated", "--pre", "--dev", "-d")

local pipenv_open_parser = parser({pipenv_libs_list}):add_flags(pipenv_default_flags)

local pipenv_run_parser = parser():add_flags(pipenv_default_flags)

local pipenv_shell_parser = parser():add_flags("--fancy", "--anyway", pipenv_default_flags)

local pipenv_sync_parser =
    parser():add_flags("--bare", "--sequential", "--keep-outdated", "--pre", "--dev", "-d", pipenv_default_flags)

local pipenv_uninstall_parser =
    parser():add_flags(
    "--skip-lock",
    "--lock",
    "--all-dev",
    "--all",
    "--editable",
    "-e",
    "--keep-outdated",
    "--pre",
    "--dev",
    "-d",
    pipenv_default_flags
)

local pipenv_update_parser =
    parser():add_flags(
    "--bare",
    "--outdated",
    "--dry-run",
    "--editable",
    "-e",
    "--ignore-pipfile",
    "--selective-upgrade",
    "--pre",
    "--requirements",
    "-r",
    "--extra-index-url",
    "--index",
    "-i",
    "--sequential",
    "--keep-outdated",
    "--dev",
    "-d",
    pipenv_default_flags
)

local pipenv_parser =
    parser(
    {
        "check" .. pipenv_check_parser,
        "clean" .. pipenv_clean_parser,
        "graph" .. pipenv_graph_parser,
        "install" .. pipenv_install_parser,
        "lock" .. pipenv_lock_parser,
        "open" .. pipenv_open_parser,
        "run" .. pipenv_run_parser,
        "shell" .. pipenv_shell_parser,
        "sync" .. pipenv_sync_parser,
        "uninstall" .. pipenv_uninstall_parser,
        "update" .. pipenv_update_parser
    }
):add_flags(
    pipenv_default_flags,
    "--where",
    "--venv",
    "--py",
    "--envs",
    "--rm",
    "--bare",
    "--completion",
    "--man",
    "--support",
    "--site-packages",
    "--version"
)

clink.arg.register_parser("pipenv", pipenv_parser)
