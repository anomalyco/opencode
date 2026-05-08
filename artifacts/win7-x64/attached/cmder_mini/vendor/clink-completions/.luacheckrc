return {
    exclude_files = { ".install", ".lua", ".luarocks", "modules/JSON.lua", "lua_modules" },
    files = {
        spec = { std = "+busted" },
    },
    globals = {
        "clink",
        "error",
        "log",
        "os",
        "path",
        "pause",
        "rl",
        "rl_state",
        "settings",
        "string.comparematches",
        "string.equalsi",
        "string.explode",
        "string.matchlen",
        "unicode",
    }
}
