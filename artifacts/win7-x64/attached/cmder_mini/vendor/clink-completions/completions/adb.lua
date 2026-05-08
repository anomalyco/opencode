--- adb.lua, Android ADB completion for Clink.
-- @compatible Android SDK Platform-tools v31.0.3 (ADB v1.0.41)
-- @author Goldie Lin
-- @date 2021-08-27
-- @see [Clink](https://github.com/chrisant996/clink)
-- @usage
--   Place it in "%LocalAppData%\clink\" if installed globally,
--   or "ConEmu/ConEmu/clink/" if you used portable ConEmu & Clink.
--

-- luacheck: no unused args
-- luacheck: ignore clink rl_state

local function dump(o)  -- luacheck: ignore
    if type(o) == 'table' then
        local s = '{ '
        local prefix = ""
        for k, v in pairs(o) do
            if type(k) ~= 'number' then k = '"'..k..'"' end
            s = s..prefix..'['..k..']="'..dump(v)..'"'
            prefix = ', '
        end
        return s..' }'
    else
        return tostring(o)
    end
end

local function generate_matches(command, pattern)
    local f = io.popen('2>nul '..command)
    if f then
        local matches = {}
        for line in f:lines() do
            if line ~= 'List of devices attached' then
                table.insert(matches, line:match(pattern))
            end
        end
        f:close()
        return  matches
    end
end

local function serialno_matches()
    return generate_matches('adb devices', '^([%w:.]+)%s+.*$')
end

local function transportid_matches()
    return generate_matches('adb devices -l', '^.*%s+transport_id:(%d+)%s*.*$')
end

local serialno_parser = clink.argmatcher():addarg({serialno_matches})
local transportid_parser = clink.argmatcher():addarg({transportid_matches})

local null_parser = clink.argmatcher():nofiles()

local devices_parser = clink.argmatcher()
:nofiles()
:addflags(
    "-l"
)

local reconnect_parser = clink.argmatcher()
:nofiles()
:addarg({
    "device",
    "offline"
})

local networking_options_parser = clink.argmatcher()
:addflags(
    "--list",
    "--no-rebind",
    "--remove",
    "--remove-all"
)

local mdns_parser = clink.argmatcher()
:nofiles()
:addarg({
    "check",
    "services"
})

local push_parser = clink.argmatcher()
:addflags(
    "--sync",
    "-n",
    "-z",
    "-Z"
)

local pull_parser = clink.argmatcher()
:addflags(
    "-a",
    "-z",
    "-Z"
)

local sync_parser = clink.argmatcher()
:addflags(
    "-n",
    "-l",
    "-z",
    "-Z"
)
:addarg({
    "all",
    "data",
    "odm",
    "oem",
    "product_services",
    "product",
    "system",
    "system_ext",
    "vendor"
})

local shell_bu_backup_parser = clink.argmatcher()
:addflags(
    "-f",
    "-all",
    "-apk",
    "-noapk",
    "-obb",
    "-noobb",
    "-shared",
    "-noshared",
    "-system",
    "-nosystem",
    "-keyvalue",
    "-nokeyvalue"
)
local backup_parser = shell_bu_backup_parser

local shell_bu_parser = clink.argmatcher()
:addarg({
    "backup" .. shell_bu_backup_parser,
    "restore"
})

local shell_parser = clink.argmatcher()
:addflags(
    "-e",
    "-n",
    "-T",
    "-t",
    "-x"
)
:addarg({
    "bu" .. shell_bu_parser
})

local install_parser = clink.argmatcher()
:addflags(
    "-l",
    "-r",
    "-t",
    "-s",
    "-d",
    "-g",
    "--abi",
    "--instant",
    "--no-streaming",
    "--streaming",
    "--fastdeploy",
    "--no-fastdeploy",
    "--force-agent",
    "--date-check-agent",
    "--version-check-agent",
    "--local-agent"
)

local install_multiple_parser = clink.argmatcher()
:addflags(
    "-l",
    "-r",
    "-t",
    "-s",
    "-d",
    "-p",
    "-g",
    "--abi",
    "--instant",
    "--no-streaming",
    "--streaming",
    "--fastdeploy",
    "--no-fastdeploy",
    "--force-agent",
    "--date-check-agent",
    "--version-check-agent",
    "--local-agent"
)

local install_multi_package_parser = clink.argmatcher()
:addflags(
    "-l",
    "-r",
    "-t",
    "-s",
    "-d",
    "-p",
    "-g",
    "--abi",
    "--instant",
    "--no-streaming",
    "--streaming",
    "--fastdeploy",
    "--no-fastdeploy",
    "--force-agent",
    "--date-check-agent",
    "--version-check-agent",
    "--local-agent"
)

local uninstall_parser = clink.argmatcher()
:addflags(
    "-k"
)

local logcat_format_parser = clink.argmatcher()
:nofiles()
:addarg({
    "brief",
    "help",
    "long",
    "process",
    "raw",
    "tag",
    "thread",
    "threadtime",
    "time",
    "color",
    "descriptive",
    "epoch",
    "monotonic",
    "printable",
    "uid",
    "usec",
    "UTC",
    "year",
    "zone"
})

local logcat_buffer_parser = clink.argmatcher()
:nofiles()
:addarg({
    "default",  -- default = main,system,crash
    "all",
    "main",
    "radio",
    "events",
    "system",
    "crash",
    "security",
    "kernel"
})

local logcat_parser = clink.argmatcher()
:nofiles()
:addflags(
    "-s",
    "-f",
    "--file",
    "-r",
    "--rotate-kbytes",
    "-n",
    "--rotate-count",
    "--id",
    "-v"       .. logcat_format_parser,
    "--format" .. logcat_format_parser,
    "-D",
    "--dividers",
    "-c",
    "--clear",
    "-d",
    "-e",
    "--regex",
    "-m",
    "--max-count",
    "--print",
    "-t",
    "-T",
    "-g",
    "--buffer-size",
    "-G",
    "--buffer-size=",
    "-L",
    "--last",
    "-b"       .. logcat_buffer_parser,
    "--buffer" .. logcat_buffer_parser,
    "-B",
    "--binary",
    "-S",
    "--statistics",
    "-p",
    "--prune",
    "-P",
    "--prune=",
    "--pid",
    "--wrap"
)
:addarg({
    "*:V",
    "*:D",
    "*:I",
    "*:W",
    "*:E",
    "*:F",
    "*:S",
})

local remount_parser = clink.argmatcher()
:nofiles()
:addflags(
    "-R"
)

local reboot_parser = clink.argmatcher()
:nofiles()
:addarg({
    "bootloader",
    "recovery",
    "sideload",
    "sideload-auto-reboot",
    "edl"
})

clink.argmatcher("adb")
:addflags(
    "-a",
    "-d",
    "-e",
    "-s"                            .. serialno_parser,
    "-p",
    "-t"                            .. transportid_parser,
    "-H",
    "-P",
    "-L"
)
:addarg({
    "help"                          .. null_parser,
    "version"                       .. null_parser,
    "devices"                       .. devices_parser,
    "connect"                       .. null_parser,
    "disconnect"                    .. null_parser,
    "pair"                          .. null_parser,
    "reconnect"                     .. reconnect_parser,
    "ppp",
    "forward"                       .. networking_options_parser,
    "reverse"                       .. networking_options_parser,
    "mdns"                          .. mdns_parser,
    "push"                          .. push_parser,
    "pull"                          .. pull_parser,
    "sync"                          .. sync_parser,
    "shell"                         .. shell_parser,
    "emu",
    "install"                       .. install_parser,
    "install-multiple"              .. install_multiple_parser,
    "install-multi-package"         .. install_multi_package_parser,
    "uninstall"                     .. uninstall_parser,
    "backup"                        .. backup_parser,
    "restore",
    "bugreport",
    "jdwp"                          .. null_parser,
    "logcat"                        .. logcat_parser,
    "disable-verity"                .. null_parser,
    "enable-verity"                 .. null_parser,
    "keygen",
    "wait-for-device"               .. null_parser,
    "wait-for-recovery"             .. null_parser,
    "wait-for-rescue"               .. null_parser,
    "wait-for-sideload"             .. null_parser,
    "wait-for-bootloader"           .. null_parser,
    "wait-for-disconnect"           .. null_parser,
    "wait-for-any-device"           .. null_parser,
    "wait-for-any-recovery"         .. null_parser,
    "wait-for-any-rescue"           .. null_parser,
    "wait-for-any-sideload"         .. null_parser,
    "wait-for-any-bootloader"       .. null_parser,
    "wait-for-any-disconnect"       .. null_parser,
    "wait-for-usb-device"           .. null_parser,
    "wait-for-usb-recovery"         .. null_parser,
    "wait-for-usb-rescue"           .. null_parser,
    "wait-for-usb-sideload"         .. null_parser,
    "wait-for-usb-bootloader"       .. null_parser,
    "wait-for-usb-disconnect"       .. null_parser,
    "wait-for-local-device"         .. null_parser,
    "wait-for-local-recovery"       .. null_parser,
    "wait-for-local-rescue"         .. null_parser,
    "wait-for-local-sideload"       .. null_parser,
    "wait-for-local-bootloader"     .. null_parser,
    "wait-for-local-disconnect"     .. null_parser,
    "get-state"                     .. null_parser,
    "get-serialno"                  .. null_parser,
    "get-devpath"                   .. null_parser,
    "remount"                       .. remount_parser,
    "reboot-bootloader"             .. null_parser,
    "reboot"                        .. reboot_parser,
    "sideload",
    "root"                          .. null_parser,
    "unroot"                        .. null_parser,
    "usb"                           .. null_parser,
    "tcpip",
    "start-server"                  .. null_parser,
    "kill-server"                   .. null_parser,
    "attach"                        .. null_parser,
    "detach"                        .. null_parser
})
