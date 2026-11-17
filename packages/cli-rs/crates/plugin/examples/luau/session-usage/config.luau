--!strict
-- TS `src/config.ts`: the settings, from defaults, then the plugin's options. TS reads a config file between them
-- (`usage-sidebar.json`); a Luau plugin reaches no file outside its own, so the options are all it has.
local usage = require("./usage")

local MIN_REFRESH_MS = 30_000
local MAX_TITLE = 40

-- A finite number, rounded as `Math.round` does and clamped to `low..high`.
local function numberIn(value: any, low: number, high: number): number?
    if type(value) ~= "number" or value ~= value or math.abs(value) == math.huge then
        return nil
    end
    return math.clamp(usage.round(value), low, high)
end

local FLAGS: { [string]: string } = {
    compact = "compact",
    showEstimate = "showEstimate",
    showMeters = "showMeters",
    showBars = "showBars",
    showReset = "showReset",
}

-- TS `parseConfig` merged into the defaults: each valid key wins, and `criticalAt` is at least `warnAt` when both are
-- set.
return function(options: any)
    local config = {
        refreshMs = 120_000,
        position = "top",
        compact = false,
        title = "Usage",
        showEstimate = true,
        showMeters = true,
        showBars = true,
        barWidth = 22,
        showReset = true,
        warnAt = 70,
        criticalAt = 90,
    }
    local input = if type(options) == "table" then options else {}
    if input.refreshMs == 0 then
        config.refreshMs = 0
    else
        config.refreshMs = numberIn(input.refreshMs, MIN_REFRESH_MS, 86_400_000) or config.refreshMs
    end
    if input.position == "top" or input.position == "bottom" then
        config.position = input.position
    end
    if type(input.title) == "string" then
        local title = (input.title :: string):match("^%s*(.-)%s*$") :: string
        if title ~= "" then
            config.title = title:sub(1, (utf8.offset(title, MAX_TITLE + 1) or (#title + 1)) - 1)
        end
    end
    for name, key in FLAGS do
        if type(input[key]) == "boolean" then
            config[name] = input[key]
        end
    end
    config.barWidth = numberIn(input.barWidth, 8, 60) or config.barWidth
    local warn, critical = numberIn(input.warnAt, 0, 100), numberIn(input.criticalAt, 0, 100)
    if warn then
        config.warnAt = warn
    end
    if critical then
        config.criticalAt = if warn and critical < warn then warn else critical
    end
    return config
end
