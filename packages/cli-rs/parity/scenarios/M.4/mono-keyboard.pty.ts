// `/settings` switches Mono on at runtime: mono turns the Kitty keyboard off (`onMonoChange`), as the keyboard
// sequences show.
import { definePty } from "../../pty/run"
import { config, leave, opened, server } from "../M.2/fixture"

export default definePty({
  args: ["mini", "-s", "ses_mini"],
  cols: 70,
  rows: 30,
  server: server(),
  setup: (root) => config(root),
  steps: [
    opened,
    { keys: "/settings", settle: 300 },
    { keys: "\r", until: { screen: "Settings" }, settle: 500, checkpoint: "settings" },
    ...Array.from({ length: 7 }, () => ({ keys: "\x1b[B", settle: 150 })),
    // TS's open panel animates its spinner preview once mono is on, so the screen does not settle.
    { keys: "\x1b[C", until: { screen: /Monochrome UI +on/ } },
    { keys: "\x1b", settle: 600, checkpoint: "mono" },
    ...leave,
  ],
  exits: true,
  keyboard: true,
  masks: [{ pattern: /^[|┃]$/, reason: "the prompt keeps its border glyph until restart (deviation M06-mini-output)" }],
})
