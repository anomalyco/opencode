import type { TuiPlugin } from "@opencode-ai/plugin/tui"
import type { BuiltinTuiPlugin } from "../builtins"
import { SessionSwitcherDialog } from "./dialog"

const id = "internal:session-switcher"

const tui: TuiPlugin = async (api) => {
  api.keymap.registerLayer({
    priority: 1000,
    commands: [
      {
        name: "session.list",
        title: "Switch session",
        category: "Session",
        namespace: "palette",
        suggested: () => api.state.session.count() > 0,
        slashName: "sessions",
        slashAliases: ["resume", "continue"],
        run() {
          api.ui.dialog.replace(() => <SessionSwitcherDialog />)
        },
      },
    ],
  })
}

const plugin: BuiltinTuiPlugin = {
  id,
  tui,
}

export default plugin
