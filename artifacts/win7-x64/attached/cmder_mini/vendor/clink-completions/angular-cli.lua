local parser = clink.arg.new_parser

local addon_parser = parser({
    "--dry-run", "-d",
    "--verbose", "-v",
    "--blueprint", "-b",
    "--skip-npm", "-sn",
    "--skip-bower", "-sb",
    "--skip-git", "-sg",
    "--directory", "-dir"
})

local asset_sizes_parser = parser({
    "--output-path", "-o"
})

local build_parser = parser({
    "--environment=", "-e",
    "--environment=dev", "-dev",
    "--environment=prod", "-prod",
    "--output-path", "-o",
    "--watch", "-w",
    "--watcher",
    "--suppress-sizes",
    "--target", "-t",
    "--target=development", "-dev",
    "--target=production", "-prod",
    "--base-href", "-bh",
    "--aot"
})

local destroy_parser = parser({
    "--dry-run", "-d",
    "--verbose", "-v",
    "--pod", "-p",
    "--classic", "-c",
    "--dummy", "-dum", "-id",
    "--in-repo-addon", "--in-repo", "-ir"
})

local generate_parser = parser({
    "class", "cl",
    "component", "c",
    "directive", "d",
    "enum", "e",
    "module", "m",
    "pipe", "p",
    "route", "r",
    "service", "s"
},{
    "--dry-run", "-d",
    "--verbose", "-v",
    "--pod", "-p",
    "--classic", "-c",
    "--dummy", "-dum", "-id",
    "--in-repo-addon", "--in-repo", "-ir"
})

local help_parser = parser({
    "--verbose", "-v",
    "--json"
})

local init_parser = parser({
    "--dry-run", "-d",
    "--verbose", "-v",
    "--blueprint", "-b",
    "--skip-npm", "-sn",
    "--skip-bower", "-sb",
    "--name", "-n",
    "--link-cli", "-lc",
    "--source-dir", "-sd",
    "--style", "--style=sass", "--style=scss", "--style=less", "--style=stylus",
    "--prefix", "-p",
    "--mobile",
    "--routing",
    "--inline-style", "-is",
    "--inline-template", "-it"
})

local new_parser = parser({
    "--dry-run", "-d",
    "--verbose", "-v",
    "--blueprint", "-b",
    "--skip-npm", "-sn",
    "--skip-git", "-sg",
    "--directory", "-dir",
    "--link-cli", "-lc",
    "--source-dir", "-sd",
    "--style",
    "--prefix", "-p",
    "--mobile",
    "--routing",
    "--inline-style", "-is",
    "--inline-template", "-it"
})

local serve_parser = parser({
    "--port", "-p",
    "--host", "-H",
    "--proxy", "-pr", "-pxy",
    "--proxy-config", "-pc",
    "--insecure-proxy", "--inspr",
    "--watcher", "-w",
    "--live-reload", "-lr",
    "--live-reload-host", "-lrh",
    "--live-reload-base-url", "-lrbu",
    "--live-reload-port", "-lrp",
    "--live-reload-live-css",
    "--environment", "-e",
    "--environment=development", "-dev",
    "--environment=production", "-prod",
    "--output-path", "-op", "-out",
    "--ssl",
    "--ssl-key",
    "--ssl-cert",
    "--target", "-t",
    "--target=development", "-dev",
    "--target=production", "-prod",
    "--aot",
    "--open", "-o"
})

local get_parser = parser({
    "--global"
})

local set_parser = parser({
    "--global", "-g"
})

local github_pages_parser = parser({
    "--message",
    "--environment",
    "--branch",
    "--skip-build",
    "--gh-token",
    "--gh-username",
    "--user-page"
})

local test_parser = parser({
    "--environment", "-e",
    "--config-file", "-c", "-cf",
    "--server", "-s",
    "--host", "-H",
    "--test-port", "-tp",
    "--filter", "-f",
    "--module", "-m",
    "--watch", "--watcher", "-w",
    "--launch",
    "--reporter", "-r",
    "--silent",
    "--test-page",
    "--page",
    "--query",
    "--code-coverage", "-cc",
    "--lint", "-l",
    "--browsers",
    "--colors",
    "--log-levevl",
    "--port",
    "--reporters",
    "--build"
})

local version_parser = parser({
    "--verbose"
})

local ng_parser = parser({
    "addon"..addon_parser,
    "asset-sizes"..asset_sizes_parser,
    "build"..build_parser, "b"..build_parser,
    "destroy"..destroy_parser, "d"..destroy_parser,
    "generate"..generate_parser, "g"..generate_parser,
    "help"..help_parser, "h"..help_parser, "--help"..help_parser, "-h"..help_parser,
    "init"..init_parser,
    "install", "i",
    "new"..new_parser,
    "serve"..serve_parser, "server"..serve_parser, "s"..serve_parser,
    "test"..test_parser, "t"..test_parser,
    "e2e",
    "lint",
    "version"..version_parser, "v"..version_parser, "--version"..version_parser, "-v"..version_parser,
    "completion",
    "doc",
    "make-this-awesome",
    "set"..set_parser,
    "get"..get_parser,
    "github-pages:deploy"..github_pages_parser
})

clink.arg.register_parser("ng", ng_parser)