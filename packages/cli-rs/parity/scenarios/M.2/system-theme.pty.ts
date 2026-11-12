// The `system` theme under a terminal that reports Tokyo Night's colors: the backgrounds of the footer's rows,
// idle and after a reply. The footer keeps the terminal's background: Rust once painted OpenTUI's dark app
// background behind it, a darker panel around the composer.
import { definePty } from "../../pty/run"
import { answer, assistant, leave, opened, server, statusMask, user } from "./fixture"

export const tokyonight = {
  foreground: "#a9b1d6",
  background: "#1a1b26",
  colors: [
    "#1a1b26",
    "#f7768e",
    "#9ece6a",
    "#e0af68",
    "#7aa2f7",
    "#ad8ee6",
    "#449dab",
    "#a9b1d6",
    "#414868",
    "#ff7a93",
    "#b9f27c",
    "#ff9e64",
    "#7da6ff",
    "#bb9af7",
    "#0db9d7",
    "#c0caf5",
  ],
}

export default definePty({
  args: ["mini", "-s", "ses_mini"],
  cols: 60,
  palette: tokyonight,
  server: server({
    events: (id) => answer(id, "Read it."),
    after: (id) => [user(id, "hello", 100), assistant("msg_a4", [{ type: "text", text: "Read it." }], 101)],
  }),
  setup: async (root) => {
    await Bun.write(
      `${root}/home/.config/opencode/cli.json`,
      JSON.stringify({ theme: { name: "system", mode: "system" }, mini: { splash: "hide" } }),
    )
  },
  steps: [
    { ...opened, checkpoint: "idle", backgrounds: "idle:backgrounds" },
    {
      keys: "hello\r",
      until: { screen: "Read it." },
      settle: 800,
      checkpoint: "replied",
      backgrounds: "replied:backgrounds",
    },
    ...leave,
  ],
  exits: true,
  masks: [statusMask],
})
