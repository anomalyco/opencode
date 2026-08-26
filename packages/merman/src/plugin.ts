import { Plugin } from "@opencode-ai/plugin/tui"
import { createMermaidCodeBlockRenderer } from "./markdown.js"
import { resolveOpenCodeDiagramPalette } from "./palette.js"

export default Plugin.define({
  id: "opencode.merman",
  setup(context) {
    context.markdown.registerCodeBlockRenderer(
      "mermaid",
      createMermaidCodeBlockRenderer(context.renderer, () => ({
        colors: resolveOpenCodeDiagramPalette(context.theme, context.themeMode),
      })),
    )
  },
})
