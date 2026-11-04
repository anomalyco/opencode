/** @jsxImportSource @opentui/solid */
// P-COMP fixtures of `TextPart`'s <markdown> options (routes/session/message-parts.tsx) beyond U.4a's rendered
// prose: U.4a's prose with markers shown (`session.markdown` is `raw`), and a grid table with `cellPaddingX: 1`.
// crates/ui/tests/all/content.rs compares opencode_ui::markdown with them.
import { useTheme, useThemes } from "../../../tui/src/context/theme"
import { renderComponent } from "../lib/component"

const prose: Record<string, string> = await Bun.file(new URL("../fixtures/U.4a/corpus.json", import.meta.url)).json()
const corpus: Record<string, string> = await Bun.file(new URL("../fixtures/U.4c/corpus.json", import.meta.url)).json()

function TextPart(props: { text: string; conceal: boolean }) {
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
        conceal={props.conceal}
        fg={theme.markdown.text}
        bg={theme.background.base}
      />
    </box>
  )
}

const cases = [
  { fixture: "U.4c/markdown-raw", text: prose.prose, conceal: false, last: "Plain closing line." },
  { fixture: "U.4c/markdown-table", text: corpus.table, conceal: true, last: "After the table." },
]

for (const item of cases) {
  await renderComponent({
    fixture: item.fixture,
    width: 60,
    height: 24,
    element: () => <TextPart text={item.text} conceal={item.conceal} />,
    ready: (frame) => frame.includes(item.last),
    // Inline code highlights in the tree-sitter worker after the text shows; let that land before the frame settles.
    act: () => Bun.sleep(500),
  })
}
