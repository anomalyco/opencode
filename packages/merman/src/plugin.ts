import { Plugin } from "@opencode-ai/plugin/tui"
import { createMermaidCodeBlockRenderer } from "./markdown.js"

export default Plugin.define({
  id: "opencode.merman",
  setup(context) {
    context.markdown.registerCodeBlockRenderer(
      "mermaid",
      createMermaidCodeBlockRenderer(context.renderer, () => ({
        colors: {
          text: context.theme.markdown.text,
          primary: context.theme.text.default,
          secondary: context.theme.text.subdued,
          muted: context.theme.border.default,
          warning: context.theme.text.feedback.info.default,
          background: context.theme.background.default,
        },
      })),
    )
  },
})
