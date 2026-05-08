local clink_version = require('clink_version')

local function args(...)
    if clink_version.new_api then
        return clink.argmatcher()
            :addflags("/?")
            :addarg(...)
            :addarg()
            :nofiles()
            :loop()
    else
        return clink.arg.new_parser({...}, "/?")
    end
end

local function flags(...)
    if clink_version.new_api then
        return clink.argmatcher()
            :addflags("/?", ...)
            :addarg({})
            :loop()
    else
        return clink.arg.new_parser("/?", ...)
    end
end

local function flagsnofiles(...)
    if clink_version.new_api then
        return flags(...):nofiles()
    else
        return clink.arg.new_parser({}, "/?", ...)
    end
end

local helpflag = flagsnofiles()

local time_parser
if clink_version.new_api then
    time_parser = clink.argmatcher()
        :addflags("/domain", "/domain:", "/rtsdomain", "/rtsdomain:", "/set", "/?")
        :addarg({})
        :loop()
else
    time_parser = flags("/domain", "/rtsdomain", "/set", "/?")
end

local use_flags = flags("/user:", "/u:", "/smartcard", "/savecred", "/delete", "/d",
                        "/persistent:yes", "/p:yes", "/persistent:no", "/p:no")
if use_flags.hideflags then
    use_flags:hideflags("/u:", "/d", "/p:yes", "/p:no")
end

local net_table =
{
    "accounts" .. flags("/forcelogoff:", "/forcelogoff:no", "/domain",
                        "/maxpwage:", "/maxpwage:unlimited", "/minpwage:",
                        "/minpwlen:","/uniquepw:"),
    "computer" .. args("*" .. flagsnofiles("/add", "/del")),
    "config" .. args("server", "workstation"),
    "continue" .. helpflag,
    "file" .. helpflag,
    "group" .. helpflag,
    "helpmsg" .. helpflag,
    "localgroup" .. helpflag,
    "pause" .. helpflag,
    "session" .. flags("/delete", "/list"),
    "share" .. helpflag,
    "start" .. helpflag,
    "statistics" .. args("server", "workstation"),
    "stop" .. helpflag,
    "time" .. time_parser,
    "use" .. use_flags,
    "user" .. helpflag,
    "view" .. flags("/cache", "/all", "/domain")
}

local help_table =
{
    "help" .. args(net_table, "names", "services", "syntax")
}

if clink_version.new_api then
    clink.argmatcher("net")
    :addflags("/?")
    :addarg(net_table, help_table)
else
    clink.arg.register_parser("net", clink.arg.new_parser(net_table), "/?")
    clink.arg.register_parser("net", clink.arg.new_parser(help_table))
end
