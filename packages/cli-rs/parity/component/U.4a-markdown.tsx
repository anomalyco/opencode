/** @jsxImportSource @opentui/solid */
// P-COMP fixtures of assistant text as the transcript shows it (`TextPart`, routes/session/message-parts.tsx): the
// TUI's <markdown> props, rendered and completed, over a small corpus. crates/ui/tests/content.rs compares
// opencode_ui::markdown with them. The documents are shared with Rust through parity/fixtures/U.4a/corpus.json.
import { useTheme, useThemes } from "../../../tui/src/context/theme"
import { renderComponent } from "../lib/component"

const corpus: Record<string, string> = await Bun.file(new URL("../fixtures/U.4a/corpus.json", import.meta.url)).json()

function TextPart(props: { text: string }) {
  const theme = useTheme()
  const { currentSyntax: syntax } = useThemes()
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
      />
    </box>
  )
}

for (const name of ["prose", "fences"]) {
  const text = corpus[name]
  const last = text
    .trim()
    .split("\n")
    .at(-1)!
    .replace(/[`*#>-]/g, "")
    .trim()
  await renderComponent({
    fixture: `U.4a/markdown-${name}`,
    width: 60,
    height: 24,
    element: () => <TextPart text={text} />,
    ready: (frame) => frame.includes(last),
    // Code blocks highlight in the tree-sitter worker after the text shows; let that land before the frame settles.
    act: () => Bun.sleep(500),
  })
}
