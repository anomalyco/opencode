// The Pr `fence` test plugin, TypeScript side: a Markdown code-block renderer for `parity` fences that draws each
// line of the fence after a label. parity/scenarios/Pr/fence.app.ts loads this directory through the cli.json
// `plugins` entry; the Rust TUI skips that entry and registers its Rust twin, a renderer claim of the fence
// (`fence_plugin` in crates/tui/tests/all/app.rs).
import { TextRenderable } from "@opentui/core"
import type { Context } from "../../../../plugin/src/tui/plugin"

export default {
  id: "parity.fence",
  setup(context: Context) {
    context.markdown.registerCodeBlockRenderer("parity", (token) => {
      const lines = token.text.split("\n").filter((line) => line.length > 0)
      return new TextRenderable(context.renderer, {
        content: lines.map((line) => `fence plugin: ${line}`).join("\n"),
        fg: context.theme.text.muted,
        height: lines.length,
      })
    })
  },
}
