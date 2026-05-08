local exports = {}

-- Busted runs these modules scripts *outside* of Clink.
-- So these Clink scripts have to work without any Clink APIs being available.
clink = clink or {}

local clink_version_encoded = clink.version_encoded or 0

-- Version check for the new v1.0.0 API redesign.
exports.new_api = (settings and settings.add and true or false)

-- Version checks for specific features.
exports.supports_display_filter_description = (clink_version_encoded >= 10010012)
exports.supports_color_settings = (clink_version_encoded >= 10010009)
exports.supports_query_rl_var = (clink_version_encoded >= 10010009)
exports.supports_path_toparent = (clink_version_encoded >= 10010020)
exports.supports_argmatcher_nosort = (clink_version_encoded >= 10030003)
exports.supports_argmatcher_hideflags = (clink_version_encoded >= 10030003)
exports.supports_argmatcher_delayinit = (clink_version_encoded >= 10030010)
exports.supports_argmatcher_chaincommand = (clink_version_encoded >= 10030013)
exports.has_volatile_matches_fix = (clink_version_encoded >= 10040013)
exports.supports_argmatcher_onlink = (clink_version_encoded >= 10050014)
exports.has_linked_setdelayinit_fix = (clink_version_encoded >= 10050016)
exports.supports_argmatcher_nowordbreakchars = (clink_version_encoded >= 10050017)

return exports
