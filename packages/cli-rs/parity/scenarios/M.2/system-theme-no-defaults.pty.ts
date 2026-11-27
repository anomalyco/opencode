// The `system` theme under a terminal that reports its palette (Tokyo Night's slots) but not its default colors (no
// OSC 10 or 11 reply): the theme comes from slots 0 and 7. The text colors show the accents mini derives from the
// slots, such as the composer's rail in the agent's color (slot 5). Rust once drew that rail in a muted purple: mini
// took the TUI's new-designs V1 migration, where TS mini takes `migrateV1`.
import { definePty } from "../../pty/run"
import { opened, server, statusMask, leave } from "./fixture"
import { tokyonight } from "./system-theme.pty"

export default definePty({
  args: ["mini", "-s", "ses_mini"],
  cols: 60,
  palette: { colors: tokyonight.colors },
  server: server(),
  setup: async (root) => {
    await Bun.write(
      `${root}/home/.config/opencode/cli.json`,
      JSON.stringify({ theme: { name: "system", mode: "system" }, mini: { splash: "hide" } }),
    )
  },
  steps: [
    {
      ...opened,
      checkpoint: "idle",
      foregrounds: "idle:foregrounds",
      // The reasoning row: Rust draws it in the reasoning color.
      deviation: { file: "M01-mini-shell", lines: 1 },
    },
    ...leave,
  ],
  exits: true,
  masks: [statusMask],
})
