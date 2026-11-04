/** @jsxImportSource @opentui/solid */
// P-COMP for P.3: `TextPart`'s <markdown> (routes/session/message-parts.tsx) with the `opencode.merman` plugin's
// code-block renderer, as the TUI registers it, over a message with a flowchart and a sequence diagram fence.
// crates/mermaid/tests/markdown.rs compares opencode_ui::markdown with the Mermaid plugin's renderer against it.
import { createMarkdownCodeBlockRenderer } from "@opentui/core"
import { useRenderer } from "@opentui/solid"
import { useTheme, useThemes } from "../../../tui/src/context/theme"
import { createMermaidCodeBlockRenderer } from "../../../merman/src/markdown"
import { resolveOpenCodeDiagramPalette } from "../../../merman/src/palette"
import { renderComponent } from "../lib/component"

const corpus: Record<string, string> = await Bun.file(new URL("../fixtures/P.3/message.json", import.meta.url)).json()

function TextPart(props: { text: string }) {
  const theme = useTheme()
  const { currentSyntax: syntax } = useThemes()
  const renderer = useRenderer()
  const renderNode = createMarkdownCodeBlockRenderer({
    mermaid: createMermaidCodeBlockRenderer(renderer, () => ({
      colors: resolveOpenCodeDiagramPalette(theme as Parameters<typeof resolveOpenCodeDiagramPalette>[0], "dark"),
    })),
  })
  return (
    <box paddingLeft={3} flexShrink={0}>
      <markdown
        syntaxStyle={syntax()}
        content={props.text.trim()}
        streaming={false}
        internalBlockMode="top-level"
        tableOptions={{ style: "grid", cellPaddingX: 1 }}
        conceal={true}
        fg={theme.markdown.text}
        bg={theme.background.base}
        renderNode={renderNode}
      />
    </box>
  )
}

await renderComponent({
  fixture: "P.3/markdown",
  width: 80,
  height: 30,
  element: () => <TextPart text={corpus.message!} />,
  ready: (frame) => frame.includes("After the diagrams."),
})
