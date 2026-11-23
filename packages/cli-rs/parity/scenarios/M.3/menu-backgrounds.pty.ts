// The command menu's backgrounds under the `system` theme, in a terminal that reports Tokyo Night's colors: the
// panel's shade, the focused search field, the highlighted row and the half-block edge below the panel.
import { definePty } from "../../pty/run"
import { tokyonight } from "../M.2/system-theme.pty"
import { leave, opened, server } from "./fixture"

export default definePty({
  args: ["mini", "-s", "ses_mini"],
  cols: 80,
  rows: 30,
  palette: tokyonight,
  server: server(),
  setup: async (root) => {
    await Bun.write(
      `${root}/home/.config/opencode/cli.json`,
      JSON.stringify({ theme: { name: "system", mode: "system" }, mini: { splash: "hide" } }),
    )
  },
  steps: [
    { ...opened, until: { screen: "ctrl+p menu" } },
    { keys: "\x10", until: { screen: "Commands" }, settle: 400, checkpoint: "menu", backgrounds: "menu:backgrounds" },
    ...leave,
  ],
  exits: true,
})
