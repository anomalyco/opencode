--preamble: common routines

local matchers = require('matchers')

local platforms = matchers.create_dirs_matcher('platforms/*')
local plugins = matchers.create_dirs_matcher('plugins/*')

-- end preamble

local parser = clink.arg.new_parser

local platform_add_parser = parser({
    "wp8",
    "windows",
    "android",
    "blackberry10",
    "firefoxos",
    matchers.dirs
}, "--usegit", "--save", "--link"):loop(1)

local plugin_add_parser = parser({matchers.dirs,
        "cordova-plugin-battery-status",
        "cordova-plugin-camera",
        "cordova-plugin-contacts",
        "cordova-plugin-device",
        "cordova-plugin-device-motion",
        "cordova-plugin-device-orientation",
        "cordova-plugin-dialogs",
        "cordova-plugin-file",
        "cordova-plugin-file-transfer",
        "cordova-plugin-geolocation",
        "cordova-plugin-globalization",
        "cordova-plugin-inappbrowser",
        "cordova-plugin-media",
        "cordova-plugin-media-capture",
        "cordova-plugin-network-information",
        "cordova-plugin-splashscreen",
        "cordova-plugin-statusbar",
        "cordova-plugin-test-framework",
        "cordova-plugin-vibration"
    },
    "--searchpath" ..parser({matchers.dirs}),
    "--noregistry",
    "--link",
    "--save",
    "--shrinkwrap"
):loop(1)

local platform_rm_parser = parser({platforms}, "--save"):loop(1)
local plugin_rm_parser = parser({plugins}, "-f", "--force", "--save"):loop(1)

local cordova_parser = parser(
    {
        -- common commands
        "create" .. parser(
            "--copy-from", "--src",
            "--link-to"
        ),
        "help",
        -- project-level commands
        "info",
        "platform" .. parser({
            "add" .. platform_add_parser,
            "remove" .. platform_rm_parser,
            "rm" .. platform_rm_parser,
            "list", "ls",
            "up" .. parser({platforms}):loop(1),
            "update" .. parser({platforms}, "--usegit", "--save"):loop(1),
            "check"
            }),
        "plugin" .. parser({
            "add" .. plugin_add_parser,
            "remove" .. plugin_rm_parser,
            "rm" .. plugin_rm_parser,
            "list", "ls",
            "search"
        }, "--browserify"),
        "prepare" .. parser({platforms}, "--browserify"):loop(1),
        "compile" .. parser({platforms},
            "--browserify",
            "--debug", "--release",
            "--device", "--emulator", "--target="):loop(1),
        "build" .. parser({platforms},
            "--browserify",
            "--debug", "--release",
            "--device", "--emulator", "--target="):loop(1),
        "run" .. parser({platforms},
            "--browserify",
            "--nobuild",
            "--debug", "--release",
            "--device", "--emulator", "--target="),
        "emulate" .. parser({platforms}),
        "serve",
    }, "-h",
    "-v", "--version",
    "-d", "--verbose")

clink.arg.register_parser("cordova", cordova_parser)
clink.arg.register_parser("cordova-dev", cordova_parser)
