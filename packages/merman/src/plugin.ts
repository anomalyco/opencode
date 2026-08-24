import { Plugin } from "@opencode-ai/plugin/tui"
import { createMermaidCodeBlockRenderer } from "./markdown.js"
import { createOpenCodeDiagramPalette } from "./palette.js"

export default Plugin.define({
  id: "opencode.merman",
  setup(context) {
    context.markdown.registerCodeBlockRenderer(
      "mermaid",
      createMermaidCodeBlockRenderer(context.renderer, () => ({
        colors: createOpenCodeDiagramPalette({
          text: context.theme.text.default,
          subdued: context.theme.text.subdued,
          info: context.theme.text.feedback.info.default,
          success: context.theme.text.feedback.success.default,
          warning: context.theme.text.feedback.warning.default,
          background: context.theme.background.default,
        }),
      })),
    )
  },
})
