--- fastboot.lua, Android Fastboot completion for Clink.
-- @compatible Android SDK Platform-tools v31.0.3
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

local serialno_parser = clink.argmatcher():addarg({generate_matches('fastboot devices', '^(%w+)%s+.*$')})

local null_parser = clink.argmatcher():nofiles()

local flashing_parser = clink.argmatcher()
:nofiles()
:addarg({
    "lock",
    "unlock",
    "lock_critical",
    "unlock_critical",
    "lock_bootloader",
    "unlock_bootloader",
    "get_unlock_ability",
    "get_unlock_bootloader_nonce"
})

local partitions = {
    "devinfo",
    "splash",
    "keystore",
    "ssd",
    "frp",
    "misc",
    "aboot",
    "abl",
    "abl_a",
    "abl_b",
    "boot",
    "boot_a",
    "boot_b",
    "recovery",
    "cache",
    "persist",
    "userdata",
    "system",
    "system_a",
    "system_b",
    "vendor",
    "vendor_a",
    "vendor_b"
}

local partitions_parser = clink.argmatcher()
:addarg(partitions)

local partitions_nofile_parser = clink.argmatcher()
:nofiles()
:addarg(partitions)

local variables_parser = clink.argmatcher()
:nofiles()
:addarg({
    "all",
    "serialno",
    "product",
    "secure",
    "unlocked",
    "variant",
    "kernel",
    "version-baseband",
    "version-bootloader",
    "charger-screen-enabled",
    "off-mode-charge",
    "battery-soc-ok",
    "battery-voltage",
    "slot-count",
    "current-slot",
    "has-slot:boot",
    "has-slot:modem",
    "has-slot:system",
    "slot-retry-count:a",
    "slot-retry-count:b",
    "slot-successful:a",
    "slot-successful:b",
    "slot-unbootable:a",
    "slot-unbootable:b"
})

local slots = {
    "a",
    "b"
}

local slot_types = {
    "all",
    "other"
}

local slots_full = {}
for _, i in ipairs(slots) do
    table.insert(slots_full, i)
end
for _, i in ipairs(slot_types) do
    table.insert(slots_full, i)
end

local slots_parser = clink.argmatcher()
:nofiles()
:addarg(slots)

local slot_types_parser = clink.argmatcher()
:nofiles()
:addarg(slots_full)

local fs_options = {
    "casefold",
    "compress",
    "projid"
}

local fs_options_parser = clink.argmatcher()
:addarg(fs_options)

local flash_raw_parser = clink.argmatcher()
:addarg({
    "boot"
})

local devices_parser = clink.argmatcher()
:nofiles()
:addflags(
    "-l"
)

local reboot_parser = clink.argmatcher()
:nofiles()
:addarg({
    "bootloader",
    "emergency"
})

local oem_parser = clink.argmatcher()
:nofiles()
:addarg({
    "lock",
    "unlock",
    "device-info",
    "select-display-panel",
    "enable-charger-screen",
    "disable-charger-screen"
})

local gsi_parser = clink.argmatcher()
:nofiles()
:addarg({
    "wipe",
    "disable"
})

local snapshotupdate_parser = clink.argmatcher()
:nofiles()
:addarg({
    "cancel",
    "merge"
})

clink.argmatcher("fastboot")
:addflags(
    "-w",
    "-u",
    "-s"                       .. serialno_parser,
    "--dtb",
    "-c",
    "--cmdline",
    "-i",
    "-h",
    "--help",
    "-b",
    "--base",
    "--kernel-offset",
    "--ramdisk-offset",
    "--tags-offset",
    "--dtb-offset",
    "-n",
    "--page-size",
    "--header-version",
    "--os-version",
    "--os-patch-level",
    "-S",
    "--slot"                   .. slot_types_parser,
    "-a"                       .. slots_parser,
    "--set-active="            .. slots_parser,
    "--skip-secondary",
    "--skip-reboot",
    "--disable-verity",
    "--disable-verification",
    "--fs-options="            .. fs_options_parser,
    "--wipe-and-use-fbe",
    "--unbuffered",
    "--force",
    "-v",
    "--verbose",
    "--version"
)
:addarg({
    "help"                         .. null_parser,
    "update",
    "flashall"                     .. null_parser,
    "flashing"                     .. flashing_parser,
    "flash"                        .. partitions_parser,
    "erase"                        .. partitions_nofile_parser,
    "format"                       .. partitions_nofile_parser,
    "getvar"                       .. variables_parser,
    "set_active"                   .. slots_parser,
    "boot",
    "flash:raw"                    .. flash_raw_parser,
    "devices"                      .. devices_parser,
    "continue"                     .. null_parser,
    "reboot"                       .. reboot_parser,
    "reboot-bootloader"            .. null_parser,
    "oem"                          .. oem_parser,
    "gsi"                          .. gsi_parser,
    "wipe-super"                   .. null_parser,
    "create-logical-partition",
    "delete-logical-partition",
    "resize-logical-partition",
    "snapshot-update"              .. snapshotupdate_parser,
    "fetch"                        .. partitions_nofile_parser,
    "stage",
    "get_staged",
})

