local w = require('tables').wrap
local path = require('path')

local packages = function (token)
    local install = clink.get_env('chocolateyinstall')
    if install then
        return w(clink.find_dirs(clink.get_env('chocolateyinstall')..'/lib/*'))
        :filter(function(dir)
            return path.is_real_dir(dir) and clink.is_match(token, dir)
        end)
        :map(function (dir)
            local package_name = dir:match("^(%w%.*)%.")
            return package_name or dir
        end)
    end
end

local parser = clink.arg.new_parser

local clist_parser = parser(
    "-a", "--all", "--allversions", "--all-versions",
    "-i", "--includeprograms", "--include-programs",
    "-l", "--lo", "--localonly", "--local-only",
    "-s", "--source".. parser({"windowsfeatures", "webpi"}),
    "-u", "--user",
    "-p", "--password")

local cinst_parser = parser(
    -- TODO: Path to packages config.
    -- See https://github.com/chocolatey/choco/wiki/CommandsInstall
    {"all", "packages.config"},
    "--ia", "--installargs", "--installarguments", "--install-arguments",
    "-i", "--ignoredependencies", "--ignore-dependencies",
    "-x", "--forcedependencies", "--force-dependencies",
    "-m", "--sxs", "--sidebyside", "--side-by-side",
    "--allowmultiple", "--allow-multiple", "--allowmultipleversions", "--allow-multiple-versions",
    "-n", "--skippowershell", "--skip-powershell",
    "--notsilent", "--not-silent",
    "-o", "--override", "--overrideargs", "--overridearguments", "--override-arguments",
    "--params", "--parameters", "--pkgparameters", "--packageparameters", "--package-parameters",
    "--pre", "--prerelease",
    "-s" .. parser({"ruby", "webpi", "cygwin", "windowsfeatures", "python"}),
    "--source" .. parser({"ruby", "webpi", "cygwin", "windowsfeatures", "python"}),
    "--version",
    "--x86", "--forcex86",
    "-u", "--user",
    "-p", "--password")

local cuninst_parser = parser({packages},
    "-a", "--all", "--allversions", "--all-versions",
    "-x", "--forcedependencies", "--force-dependencies",
    "--ia", "--installargs", "--installarguments", "--install-arguments",
    "-n", "--skippowershell", "--skip-powershell",
    "--notsilent", "--not-silent",
    "-o", "--override", "--overrideargs", "--overridearguments", "--override-arguments",
    "--params", "--parameters", "--pkgparameters", "--packageparameters", "--package-parameters",
    "--version")

local cup_parser = parser(
    --TODO: complete locally installed packages
    {packages, "all"},
    "--ia", "--installargs", "--installarguments", "--install-arguments",
    "-i", "--ignoredependencies", "--ignore-dependencies",
    "-m", "--sxs", "--sidebyside", "--side-by-side",
    "--allowmultiple", "--allow-multiple", "--allowmultipleversions", "--allow-multiple-versions",
    "-n", "--skippowershell", "--skip-powershell",
    "--notsilent", "--not-silent",
    "-o", "--override", "--overrideargs", "--overridearguments", "--override-arguments",
    "--params", "--parameters", "--pkgparameters", "--packageparameters", "--package-parameters",
    "--pre", "--prerelease",
    "-s" .. parser({"ruby", "webpi", "cygwin", "windowsfeatures", "python"}),
    "--source" .. parser({"ruby", "webpi", "cygwin", "windowsfeatures", "python"}),
    "--version",
    "--x86", "--forcex86",
    "-u", "--user",
    "-p", "--password"):loop(1)

local sources_parser = parser({
    "add"..parser(
        "-n", "--name",
        "-u", "--user",
        "-p", "--password",
        "-s", "-source"),
    "disable"..parser("-n", "--name"),
    "enable"..parser("-n", "--name"),
    "list",
    "remove"..parser("-n", "--name")})

local chocolatey_parser = parser({
    --TODO: https://github.com/chocolatey/choco/wiki/CommandsReference
        -- Default Options and Switches
        -- new - generates files necessary for a Chocolatey package
        -- pack - packages up a nuspec to a compiled nupkg
        -- push - pushes a compiled nupkg
    "apikey"..parser("-s", "--source", "-k", "--key", "--apikey", "--api-key"),
    "setapikey"..parser("-s", "--source", "-k", "--key", "--apikey", "--api-key"),
    "feature"..parser({
        "list",
        "disable"..parser("-n", "--name"),
        "enable"..parser("-n", "--name")
    }),
    "install"..cinst_parser,
    "list"..clist_parser,
    "outdated"..parser(
        "-s", "--source",
        "-u", "--user",
        "-p", "--password"),
    "pin"..parser({"add", "remove", "list"}, "-n", "--name", "--version"),
    "source"..sources_parser,
    "sources"..sources_parser,
    "search"..clist_parser,
    "upgrade"..cup_parser,
    "uninstall"..cuninst_parser
    }, "/?")

clink.arg.register_parser("choco", chocolatey_parser)
clink.arg.register_parser("chocolatey", chocolatey_parser)
clink.arg.register_parser("cinst", cinst_parser)
clink.arg.register_parser("clist", clist_parser)
clink.arg.register_parser("cuninst", cuninst_parser)
clink.arg.register_parser("cup", cup_parser)