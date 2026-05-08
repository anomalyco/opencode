local matchers = require('matchers')

local parser = clink.arg.new_parser

local runtime_parser = parser({
    -- Windows
    "win-x64", "win-x86", "win-arm", "win-arm64", "win7-x64", "win7-x86",
    "win81-x64", "win81-x86", "win81-arm", "win10-x64", "win10-x86", "win10-arm",
    "win10-arm64",

    -- Linux
    "linux-x64", "linux-musl-x64", "linux-arm", "rhel-x64", "rhel.6-x64", "tizen",
    "tizen.4.0.0", "tizen.5.0.0",

    -- macOS
    "osx-x64", "osx.10.10-x64", "osx.10.11-x64", "osx.10.12-x64", "osx.10.13-x64",
    "osx.10.14-x64"
})

local framework_parser = parser({
    "netstandard1.0", "netstandard1.1", "netstandard1.2", "netstandard1.3",
    "netstandard1.4", "netstandard1.5", "netstandard1.6", "netstandard2.0",
    "netstandard2.1",

    "netcoreapp1.0", "netcoreapp1.1", "netcoreapp2.0", "netcoreapp2.1",
    "netcoreapp2.2", "netcoreapp3.0", "netcoreapp3.1",

    "net11", "net20", "net35", "net40", "net403", "net45", "net451", "net452",
    "net46", "net461", "net462", "net47", "net471", "net472", "net48"
})

local verbosity_parser = parser({"quiet", "minimal", "normal", "detailed", "diagnostic"})

local configuration_parser = parser({"Debug", "Release"})

local build_parser = parser({matchers.files})

build_parser:add_flags(
    "--configuration"..configuration_parser,
    "--force",
    "--framework"..framework_parser,
    "--help",
    "--interactive",
    "--nologo",
    "--no-dependencies",
    "--no-incremental",
    "--no-restore",
    "--output",
    "--runtime"..runtime_parser,
    "--verbosity"..verbosity_parser,
    "--version-suffix"
)

local publish_parser = parser({matchers.files})

publish_parser:add_flags({
    "--configuration"..configuration_parser,
    "--force",
    "--framework"..framework_parser,
    "--help",
    "--manifest",
    "--no-build",
    "--no-dependencies",
    "--no-restore",
    "--output",
    "--runtime"..runtime_parser,
    "--self-contained",
    "--verbosity"..verbosity_parser,
    "--version-suffix",
}):loop(1)


local clean_parser = parser({matchers.files})

clean_parser:add_flags(
    "--configuration"..configuration_parser,
    "--framework"..framework_parser,
    "--help",
    "--interactive",
    "--nologo",
    "--output",
    "--runtime",
    "--verbosity"..verbosity_parser
)

local mvc_webapp_parser = parser({
    "--auth"..parser({"None", "Individual", "IndividualB2C", "SingleOrg", "MultiOrg", "Windows"}),
    "--aad-b2c-instance",
    "--susi-policy-id",
    "--reset-password-policy-id",
    "--edit-profile-policy-id",
    "--aad-instance",
    "--client-id",
    "--domain",
    "--tenant-id",
    "--callback-path",
    "--org-read-access",
    "--exclude-launch-settings",
    "--no-https",
    "--use-local-db",
    "--no-restore"
}):loop(1)

local new_parser = parser({
    "angular", "react", "reactredux",
    "blazorserver",
    "classlib"..parser({"--framework"..framework_parser, "--langVersion", "--no-restore"}),
    "console"..parser({"--langVersion", "--no-restore"}),
    "gitignore",
    "globaljson"..parser({"--sdk-version"}),
    "grpc",
    "mstest",
    "mvc"..mvc_webapp_parser,
    "nugetconfig",
    "nunit-test",
    "nunit",
    "page"..parser({"--namespace", "--no-pagemodel"}),
    "razorclasslib",
    "razorcomponent",
    "sln",
    "tool-manifest",
    "viewimports"..parser({"--namespace"}),
    "viewstart",
    "web"..parser({"--exclude-launch-settings", "--no-restore", "--no-https"}),
    "webapi",
    "webapp"..mvc_webapp_parser,
    "webconfig",
    "wpf", "wpflib", "wpfcustomcontrollib", "wpfusercontrollib", "winforms", "winformslib",
    "worker",
    "xunit"
})

new_parser:add_flags(
    "--dry-run", "--force", "--help", "--install", "--list", "--language", "--name",
    "--nuget-source", "--output", "--type", "--update-check", "--update-apply"
)

local run_parser = parser({matchers.files})

run_parser:add_flags(
    "--configuration"..configuration_parser,
    "--force",
    "--framework"..framework_parser,
    "--help",
    "--launch-profile",
    "--no-restore",
    "--project",
    "--runtime"..runtime_parser,
    "--verbosity"..verbosity_parser
)

local ef_parser = parser({
    "database"..parser({
        "drop"..parser("--force", "--dry-run"),
        "update"
    }),
    "dbcontext"..parser({
        "info",
        "list",
        "scaffold"..parser(
            "--data-annotations",
            "--context",
            "--context-dir",
            "--force",
            "--output-dir",
            "--schema",
            "--table",
            "--use-database-names"
        ),
    }),
    "migrations"..parser({
        "add"..parser("--output-dir"),
        "list",
        "remove"..parser("--force"),
        "script"..parser("--output-dir", "--idempotent")
    })
})

ef_parser:add_flags(
    "--context", -- <DbContext>
    "--project", -- <Project>
    "--startup-project", -- <Project>
    "--framework"..framework_parser,
    "--configuration"..configuration_parser,
    "--runtime"..runtime_parser,
    "--json", "--help", "--verbose", "--no-color", "--prefix-output"
)

local dotnet_parser = parser({
    "add"..parser({"reference", "package"}),
    "build"..build_parser,
    "build-server",
    "clean"..clean_parser,
    "help",
    "list"..parser({"reference", "package"}),
    "msbuild",
    "new"..new_parser,
    "nuget",
    "pack",
    "publish"..publish_parser,
    "remove"..parser({"reference", "package"}),
    "restore",
    "run"..run_parser,
    "sln"..parser({"add", "remove", "list"}),
    "store",
    "test",
    "tool",
    "vstest",

    -- Tools:
    "ef"..ef_parser
})

dotnet_parser:add_flags(
    "--help", "--info", "--list-sdks", "--list-runtimes"
)

clink.arg.register_parser("dotnet", dotnet_parser)
