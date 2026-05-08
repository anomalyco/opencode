local clink_version = require('clink_version')

local exports = {}

exports.BLACK   = 0
exports.RED     = 1
exports.GREEN   = 2
exports.YELLOW  = 3
exports.BLUE    = 4
exports.MAGENTA = 5
exports.CYAN    = 6
exports.WHITE   = 7
exports.DEFAULT = 9
exports.BOLD    = 1

exports.set_color = function (fore, back, bold)
    local err_message = "All arguments must be either nil or numbers between 0-9"
    assert(fore == nil or (type(fore) == "number" and fore >= 0 and fore <=9), err_message)
    assert(back == nil or (type(back) == "number" and back >= 0 and back <=9), err_message)

    fore = fore or exports.DEFAULT
    back = back or exports.DEFAULT
    bold = bold and exports.BOLD or 22

    return "\x1b[3"..fore..";"..bold..";".."4"..back.."m"
end

exports.get_clink_color = function (setting_name)
	-- Clink's settings.get() returns SGR parameters for a CSI SGR escape code.
    local sgr = clink_version.supports_color_settings and settings.get(setting_name) or ""
    if sgr ~= "" then
        sgr = "\x1b["..sgr.."m"
    end
    return sgr
end

exports.color_text = function (text, fore, back, bold)
    return exports.set_color(fore, back, bold)..text..exports.set_color()
end

return exports
