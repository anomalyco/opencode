--!strict
-- The distractor of the views machine (parity/machines/plugins.json), opencode-native side: `tui.tsx` in Luau, whose
-- setup throws, with its own cause, under the option fail.
local plugin = require("@opencode/plugin")

return plugin.define(function(setup)
    if setup.options and setup.options.fail then
        error("other setup fails as it loads")
    end
end)
