import { Plugin } from "@opencode-ai/plugin/tui"
import { createMermaidCodeBlockRenderer } from "./markdown.js"
import { createOpenCodeDiagramPalette } from "./palette.js"

export default Plugin.define({
  id: "opencode.merman",
  setup(context) {
    context.markdown.registerCodeBlockRenderer(
      "mermaid",
      createMermaidCodeBlockRenderer(context.renderer, () => {
        const accent = context.theme.categorical[3] ?? context.theme.categorical[0]!
        const dark = (context.theme.source(context.theme.background.default)?.step ?? 800) >= 500
        return {
          colors: createOpenCodeDiagramPalette({
            text: context.theme.text.default,
            subdued: context.theme.text.subdued,
            info: context.theme.text.feedback.info.default,
            success: context.theme.text.feedback.success.default,
            warning: context.theme.text.feedback.warning.default,
            background: context.theme.background.default,
            accent: {
              soft: accent[dark ? 300 : 700],
              clear: accent[dark ? 200 : 800],
            },
          }),
        }
      }),
    )
  },
})
