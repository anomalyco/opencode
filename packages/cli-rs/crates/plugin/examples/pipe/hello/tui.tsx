/** @jsxImportSource @opentui/solid */
// `examples/hello` as a TypeScript TUI plugin, which the JS host runs.
import { Plugin } from "@opencode/plugin/tui"

export default Plugin.define({
  id: "example.ts-hello",
  setup(context) {
    // A command in the palette and as `/hello`.
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
    // A line at the end of the home screen's footer; a click runs the command.
    context.ui.slot({
      append: "home.footer",
      render: () => (
        <text fg={context.theme.text.muted} onMouseUp={() => context.keymap.dispatch("hello.greet")}>
          hello
        </text>
      ),
    })
  },
})
