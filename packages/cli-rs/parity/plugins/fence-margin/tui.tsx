// The fence-margin test plugin, TypeScript side: a code-block renderer for `parity` fences that draws `fence: <code>`
// and sets no margin of its own, as a plugin that does not know Core's top-level Markdown keeps none for it.
// parity/scenarios/P.2/plugin-fence-margin.app.ts loads this directory through the cli.json `plugins` entry; the
// Rust TUI skips that entry and registers its Rust twin (`fence_margin_plugin` in crates/tui/tests/all/app.rs).
import { TextRenderable } from "@opentui/core"
import type { Context } from "../../../../plugin/src/tui/plugin"

export default {
  id: "parity.fence-margin",
  setup(context: Context) {
    context.markdown.registerCodeBlockRenderer(
      "parity",
      (token) => new TextRenderable(context.renderer, { content: `fence: ${token.text}` }),
    )
  },
}
