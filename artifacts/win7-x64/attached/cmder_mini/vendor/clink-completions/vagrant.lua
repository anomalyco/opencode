local matchers = require('matchers')
local path = require('path')
local parser = clink.arg.new_parser

local boxes = matchers.create_dirs_matcher(clink.get_env("userprofile") .. "/.vagrant.d/boxes/*")

local function is_empty(s)
  return s == nil or s == ''
end

local function find_vagrantfile(start_dir)
    local vagrantfile_name = clink.get_env("VAGRANT_VAGRANTFILE")
    if is_empty(vagrantfile_name) then vagrantfile_name = "Vagrantfile" end

    local function has_vagrantfile(dir)
        return #clink.find_files(dir .. "./" .. vagrantfile_name .. "*") > 0
    end

    if not start_dir or start_dir == '.' then start_dir = clink.get_cwd() end

    if has_vagrantfile(start_dir) then return io.open(start_dir.."\\"..vagrantfile_name) end

    local parent_path =  path.pathname(start_dir)
    if parent_path ~= start_dir then return find_vagrantfile(parent_path) end
end

local function get_vagrantfile()
    local vagrant_cwd = clink.get_env("VAGRANT_CWD")
    if not is_empty(vagrant_cwd) then
        return find_vagrantfile(vagrant_cwd)
    else
        return find_vagrantfile()
    end
end

local function delete_ruby_comment(line)
  if line == nil then return nil end
    local index = string.find(line, '#')
    if index and index > 0 then
        return string.sub(line, 0, index-1)
    end
  return line
end

local get_provisions = function ()
    local vagrant_file = get_vagrantfile()
    if vagrant_file == nil then return {} end

    local provisions = {}
    for line in vagrant_file:lines() do
        line = delete_ruby_comment(line)
        if not is_empty(line) then
            local provision_name = line:match('.vm.provision[ \r\t]+[\"|\']([A-z]+[A-z0-9|-]*)[\"|\']')

            if not is_empty(provision_name) then
                table.insert(provisions, provision_name)
            end
        end
    end
    vagrant_file:close()
    return provisions
end

local vagrant_parser = parser({
    "box" .. parser({
        "add" .. parser(
            "--checksum",
            "--checksum-type" .. parser({"md5", "sha1", "sha256"}),
            "-c", "--clean",
            "-f", "--force",
            "--insecure",
            "--cacert",
            "--cert",
            "--provider"
            ),
        "list" .. parser("-i", "--box-info"),
        "outdated"..parser("--global", "-h", "--help"),
        "remove" .. parser({boxes}),
        "repackage" .. parser({boxes}),
        "update"
        }),
    "connect",
    "destroy" .. parser("-f", "--force"),
    "global-status",
    "halt" .. parser("-f", "--force"),
    "init" .. parser({boxes}, {}, "--output"),
    "package" .. parser("--base", "--output", "--include", "--vagrantfile"),
    "plugin" .. parser({
        "install" .. parser(
            "--entry-point",
            "--plugin-prerelease",
            "--plugin-source",
            "--plugin-version"
            ),
        "license",
        "list",
        "uninstall",
        "update" .. parser(
            "--entry-point",
            "--plugin-prerelease",
            "--plugin-source",
            "--plugin-version"
            )
        }),
    "provision" .. parser("--provision-with" .. parser({get_provisions}), "--no-parallel", "--parallel"),
    "reload" .. parser("--provision-with" .. parser({get_provisions}), "--no-parallel", "--parallel"),
    "resume",
    "ssh" .. parser("-c", "--command", "-p", "--plain") ,
    "ssh-config",
    "snapshot" .. parser({
    "push",
    "pop" .. parser(
        "--provision",
        "--no-provision",
        "--no-delete"),
    "save",
    "restore" .. parser(
        "--provision",
        "--no-provision"),
    "list",
    "delete"}),
    "status",
    "suspend",
    "up" .. parser(
        "--provision",
        "--no-provision",
        "--provision-with" .. parser({get_provisions}),
        "--destroy-on-error",
        "--no-destroy-on-error",
        "--parallel",
        "--no-parallel",
        "--provider"
        )
    }, "-h", "--help", "-v", "--version")

local help_parser = parser({
    "help" .. parser(vagrant_parser:flatten_argument(1))
})

clink.arg.register_parser("vagrant", vagrant_parser)
clink.arg.register_parser("vagrant", help_parser)