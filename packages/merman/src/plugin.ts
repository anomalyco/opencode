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
          text: context.theme.markdown.text,
          primary: context.theme.text.default,
          secondary: context.theme.text.subdued,
          muted: context.theme.border.default,
          accent: context.theme.text.action.primary.focused,
          warning: context.theme.text.feedback.info.default,
          background: context.theme.background.default,
        },
      })),
    )
  },
})
