local parser = clink.arg.new_parser

local repos = {
    -- repos names
    -- platforms
    "android", "ios", "blackberry", "windows", "wp8", "firefoxos", "osx","ubuntu",
    "amazon-fireos", "bada", "bada-wac", "webos", "qt", "tizen",
    -- plugins
    "plugin-battery-status", "plugin-camera", "plugin-console", "plugin-contacts",
    "plugin-device-motion", "plugin-device-orientation", "plugin-device",
    "plugin-dialogs", "plugin-file-transfer", "plugin-file", "plugin-geolocation",
    "plugin-globalization", "plugin-inappbrowser", "plugin-media",
    "plugin-media-capture", "plugin-network-information", "plugin-splashscreen",
    "plugin-vibration", "plugin-statusbar", "cordova-plugins",
    --tools
    "docs", "mobile-spec", "js","app-hello-world", "cli", "plugman", "lib", "common",
    "coho", "medic", "app-harness", "labs", "registry-web", "registry",
    "dist", "dist/dev", "private-pmc", "website",
    --repos groups
    "active-platform", "all", "auto", "cadence", "platform", "plugins",
    "release-repos", "tools"
}

local coho_parser = parser(
    {
        "repo-clone" .. parser(
            "-r" .. parser(repos),
            "--repo" .. parser(repos),
            "--chdir", "--no-chdir",
            "--depth"
        ),
        "repo-update" .. parser(
            "--chdir", "--no-chdir",
            "-b", "--branch",
            "-r" .. parser(repos),
            "--repo" .. parser(repos),
            "--fetch",
            "--depth",
            "-h", "--help"
        ),
        "repo-reset" .. parser(
            "--chdir",
            "-b", "--branch",
            "-r" .. parser(repos),
            "--repo" .. parser(repos),
            "-h", "--help"
        ),
        "repo-status" .. parser(
            "--chdir",
            "-b", "--branch",
            "-r" .. parser(repos),
            "--repo" .. parser(repos),
            "--branch2",
            "--diff",
            "-h", "--help"
        ),
        "repo-push",
        "list-repos",
    -- release management
        "prepare-release-branch",
        "tag-release",
        "audit-license-headers",
        "check-license",
        "create-archive"..parser(
            '-r'..parser(repos),
            '--repo'..parser(repos),
            '--dest'
        ),
        "verify-archive",
        "print-tags"..parser(
            '-r'..parser(repos),
            '--repo'..parser(repos),
            '--tag' -- TODO: get tags based on dir and functionality from git.lua
        ),
        "verify-tags",
        "list-release-urls",
        "nightly",
        "npm-publish-tag",
        "update-release-notes",
        "npm-unpublish-nightly",
        -- other commands
        "list-pulls",
        "last-week",
        "shortlog",
        "for-each",
        "npm-link",
        "create-pr",
        "merge-pr"..parser("--pr")
    },
    "--chdir",
    "--no-chdir",
    "-h"
    )

clink.arg.register_parser("coho", coho_parser)
