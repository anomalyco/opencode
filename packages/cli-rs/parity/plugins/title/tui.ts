// The P0b title plugin, TypeScript side: `/p0btitle` sets the terminal title, as an npm plugin does with
// `renderer.setTerminalTitle`. parity/scenarios/P.0b/fixture.ts installs this file and the sample plugin built with
// the `title` feature (its Rust twin, `Host::set_title`) side by side in one `plugins` directory: TS loads `tui.ts`,
// Rust loads `plugin.so`.
import type { Context } from "../../../../plugin/src/tui/plugin"

export default {
  id: "parity.title",
  setup(context: Context) {
    // Global, as the TS built-ins' commands are and as Rust registers a plugin's commands.
    context.keymap.layer(() => ({
      mode: "global",
      commands: [
        {
          id: "p0b.title",
          title: "Set the title",
          palette: true,
          slash: { name: "p0btitle" },
          run: () => context.renderer.setTerminalTitle("p0b title"),
        },
      ],
    }))
  },
}
