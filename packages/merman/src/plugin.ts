import { Plugin } from "@opencode-ai/plugin/tui"
import { createMermaidMarkdownRenderer } from "./markdown.js"

export default Plugin.define({
  id: "opencode.merman",
  setup(context) {
    context.markdown.registerCodeBlockRenderer(
      "mermaid",
      createMermaidMarkdownRenderer(context.renderer, () => ({
        compact: true,
        colors: {
          text: context.theme.text.default,
          primary: context.theme.hue.accent[500],
          secondary: context.theme.hue.cyan[500],
          muted: context.theme.text.subdued,
          accent: context.theme.hue.accent[500],
          warning: context.theme.text.feedback.warning.default,
          background: context.theme.background.default,
        },
      })),
    )
  },
})
