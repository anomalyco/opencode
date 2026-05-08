--- scrcpy.lua, Genymobile's scrcpy completion for Clink.
-- @compatible scrcpy v1.21
-- @author Goldie Lin
-- @date 2021-12-12
-- @see [Clink](https://github.com/chrisant996/clink)
-- @see [scrcpy](https://github.com/Genymobile/scrcpy)
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

local serialno_parser = clink.argmatcher():addarg({serialno_matches})

local null_parser = clink.argmatcher():nofiles()

local bitrate_parser = clink.argmatcher()
:nofiles()
:addarg({
    "8000000"           .. null_parser,
    "8000K"             .. null_parser,
    "8M"                .. null_parser
})

local crop_parser = clink.argmatcher()
:nofiles()
:addarg({
    "720:1280:50:50"    .. null_parser
})

local display_parser = clink.argmatcher()
:nofiles()
:addarg({
    "0"                 .. null_parser
})

local lockvideoorientation_parser = clink.argmatcher()
:nofiles()
:addarg({
    "unlocked"          .. null_parser,
    "initial"           .. null_parser,
    "0"                 .. null_parser,
    "1"                 .. null_parser,
    "2"                 .. null_parser,
    "3"                 .. null_parser
})

local maxfps_parser = clink.argmatcher()
:nofiles()
:addarg({
    "60"                .. null_parser
})

local maxsize_parser = clink.argmatcher()
:nofiles()
:addarg({
    "0"                 .. null_parser
})

local portnumber_parser = clink.argmatcher()
:nofiles()
:addarg({
    "27183"             .. null_parser
})

local pushtarget_parser = clink.argmatcher()
:nofiles()
:addarg({
    "/sdcard/"
})

local recordformat_parser = clink.argmatcher()
:nofiles()
:addarg({
    "mp4"               .. null_parser,
    "mkv"               .. null_parser
})

local renderdriver_parser = clink.argmatcher()
:nofiles()
:addarg({
    "direct3d"          .. null_parser,
    "metal"             .. null_parser,
    "opengl"            .. null_parser,
    "opengles"          .. null_parser,
    "opengles2"         .. null_parser,
    "software"          .. null_parser
})

local rotation_parser = clink.argmatcher()
:nofiles()
:addarg({
    "0"                 .. null_parser,
    "1"                 .. null_parser,
    "2"                 .. null_parser,
    "3"                 .. null_parser
})

local shortcutmod_parser = clink.argmatcher()
:nofiles()
:addarg({
    "lalt,lsuper"       .. null_parser,
    "lctrl"             .. null_parser,
    "rctrl"             .. null_parser,
    "lalt"              .. null_parser,
    "ralt"              .. null_parser,
    "lsuper"            .. null_parser,
    "rsuper"            .. null_parser
})

local verbosity_parser = clink.argmatcher()
:nofiles()
:addarg({
    "debug"             .. null_parser,
    "info"              .. null_parser,
    "warn"              .. null_parser,
    "error"             .. null_parser
})

local windowx_parser = clink.argmatcher()
:nofiles()
:addflags({
    "-1"                .. null_parser
})

local windowy_parser = clink.argmatcher()
:nofiles()
:addflags({
    "-1"                .. null_parser
})

local windowwidth_parser = clink.argmatcher()
:nofiles()
:addarg({
    "0"                 .. null_parser
})

local windowheight_parser = clink.argmatcher()
:nofiles()
:addarg({
    "0"                 .. null_parser
})

clink.argmatcher("scrcpy")
:nofiles()
:addflags(
    "--always-on-top"            .. null_parser,
    "-b"                         .. bitrate_parser,
    "--bit-rate"                 .. bitrate_parser,
    "--codec-options",
    "--crop"                     .. crop_parser,
    "--disable-screensaver"      .. null_parser,
    "--display"                  .. display_parser,
    "--display-buffer",
    "--encoder",
    "--force-adb-forward"        .. null_parser,
    "--forward-all-clicks"       .. null_parser,
    "-f"                         .. null_parser,
    "--fullscreen"               .. null_parser,
    "-K"                         .. null_parser,
    "--hid-keyboard"             .. null_parser,
    "-h"                         .. null_parser,
    "--help"                     .. null_parser,
    "--legacy-paste"             .. null_parser,
    "--lock-video-orientation"   .. lockvideoorientation_parser,
    "--max-fps"                  .. maxfps_parser,
    "-m"                         .. maxsize_parser,
    "--max-size"                 .. maxsize_parser,
    "--no-clipboard-autosync"    .. null_parser,
    "-n"                         .. null_parser,
    "--no-control"               .. null_parser,
    "-N"                         .. null_parser,
    "--no-display"               .. null_parser,
    "--no-key-repeat"            .. null_parser,
    "--no-mipmaps"               .. null_parser,
    "-p"                         .. portnumber_parser,
    "--port"                     .. portnumber_parser,
    "--power-off-on-close"       .. null_parser,
    "--prefer-text"              .. null_parser,
    "--push-target"              .. pushtarget_parser,
    "--raw-key-events"           .. null_parser,
    "-r",
    "--record",
    "--record-format"            .. recordformat_parser,
    "--render-driver"            .. renderdriver_parser,
    "--render-expired-frames"    .. null_parser,
    "--rotation"                 .. rotation_parser,
    "-s"                         .. serialno_parser,
    "--serial"                   .. serialno_parser,
    "--shortcut-mod"             .. shortcutmod_parser,
    "-S"                         .. null_parser,
    "--turn-screen-off"          .. null_parser,
    "-t"                         .. null_parser,
    "--show-touches"             .. null_parser,
    "--tunnel-host",
    "--tunnel-port",
    "--v4l2-sink",
    "--v4l2-buffer",
    "-V"                         .. verbosity_parser,
    "--verbosity"                .. verbosity_parser,
    "-v"                         .. null_parser,
    "--version"                  .. null_parser,
    "-w"                         .. null_parser,
    "--stay-awake"               .. null_parser,
    "--tcpip",
    "--window-borderless"        .. null_parser,
    "--window-title",
    "--window-x"                 .. windowx_parser,
    "--window-y"                 .. windowy_parser,
    "--window-width"             .. windowwidth_parser,
    "--window-height"            .. windowheight_parser
)
