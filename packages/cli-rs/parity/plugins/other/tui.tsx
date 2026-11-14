// The distractor of the views machine (parity/machines/plugins.json): a second plugin beside life whose setup throws,
// with its own cause, under the option fail. Its Rust twin is `other` in crates/tui/tests/all/plugin_machines.rs.
import type { Context } from "../../../../plugin/src/tui/plugin"

export default {
  id: "parity.other",
  setup(context: Context) {
    if (context.options?.fail) throw new Error("other setup fails as it loads")
  },
}
