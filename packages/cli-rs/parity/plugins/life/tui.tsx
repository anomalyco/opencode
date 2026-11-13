// The plugin of the life machine (parity/machines/plugins.json), TypeScript side: a line in home.footer that shows A
// or B, and four palette commands. Life flip flips the line, Life throw throws, Life arm makes the next setup throw,
// and Life dialog opens a prompt. The TS reader copies this file and rewrites `build` to reload it. Its Rust twin is
// `life` in crates/tui/tests/all/plugin_machines.rs; each is checked against the file, not against the other.
import type { Context } from "../../../../plugin/src/tui/plugin"
import { createSignal } from "solid-js"

const build = 1

// Module state outlives an activation, so an armed setup throws on the next enable. It is kept by the `run` option,
// as one process can run several apps.
const armed = new Set<unknown>()

export default {
  id: "parity.life",
  setup(context: Context) {
    const run = context.options?.run
    if (armed.delete(run)) throw new Error("life setup armed to throw")
    const [side, setSide] = createSignal("A")
    context.keymap.layer(() => ({
      mode: "global",
      commands: [
        {
          id: "life.flip",
          title: "Life flip",
          palette: true,
          run: () => {
            setSide(side() === "A" ? "B" : "A")
          },
        },
        {
          id: "life.throw",
          title: "Life throw",
          palette: true,
          run: () => {
            throw new Error("life command throws")
          },
        },
        {
          id: "life.arm",
          title: "Life arm",
          palette: true,
          run: () => {
            armed.add(run)
          },
        },
        {
          id: "life.dialog",
          title: "Life dialog",
          palette: true,
          run: () => {
            void context.ui.dialog.prompt({ title: "Life prompt" })
          },
        },
      ],
    }))
    context.ui.slot({
      append: "home.footer",
      render: () => (
        <box paddingLeft={2}>
          <text fg={context.theme.text.muted}>
            life plugin: {side()} build {build}
          </text>
        </box>
      ),
    })
  },
}
