// anomalyco/opentui#2056 tells a text-sizing probe reply (row 2) from a modified F3 key (`CSI 1;m R`). The settings
// dialog is bound to Shift+F3. After startup the terminal sends the legacy form `CSI 1;2R`, which TS opens the dialog
// on since Core 0.9.4 and Rust reads as a reply under the Kitty protocol (parity/deviations/OT094-legacy-shift-f3.md),
// then the Kitty form `CSI 13;2~`, which both open it on.
import { definePty } from "../../pty/run"
import { home, homeMasks } from "./home"

const config = JSON.stringify({
  experimental: { "new-designs": true },
  debug: { devtools: false },
  keybinds: { "opencode.settings": "shift+f3" },
})

export default definePty({
  args: [],
  cols: 100,
  rows: 30,
  ...home,
  env: { OPENCODE_CLI_CONFIG_CONTENT: config },
  steps: [
    { until: { screen: "█▀▀█" }, settle: 500, timeout: 30_000 },
    {
      keys: "\x1b[1;2R",
      settle: 800,
      checkpoint: "shift-f3",
      deviation: { file: "OT094-legacy-shift-f3", lines: 12 },
    },
    { keys: "\x1b[13;2~", settle: 800, checkpoint: "kitty-shift-f3" },
  ],
  masks: homeMasks,
})
