// The Luau quick start's TypeScript twin (spike `luau-spike`): `/hello` shows a toast, and a muted line closes the home
// footer. parity/scenarios/P.luau/hello.pty.ts installs this file beside the Luau plugin
// (`crates/plugin/examples/luau/hello`) in one `plugins` directory: TS loads `tui.tsx`, Rust with
// `OPENCODE_PLUGIN_LUAU=1` loads `plugin.toml` and `init.luau`.
import type { Context } from "../../../../plugin/src/tui/plugin"

export default {
  id: "example.luau-hello",
  setup(context: Context) {
    context.keymap.layer(() => ({
      mode: "global",
      commands: [
        {
          id: "hello.greet",
          title: "Say hello",
          palette: true,
          slash: { name: "hello" },
          run: () => context.ui.toast.show({ variant: "success", message: "Hello from a plugin" }),
        },
      ],
    }))
    context.ui.slot({
      append: "home.footer",
      render: () => <text fg={context.theme.text.muted}>hello</text>,
    })
  },
}
