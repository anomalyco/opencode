/** @jsxImportSource @opentui/solid */
// P-COMP fixtures of highlighted code, one per grammar of the default build: each snippet of
// parity/fixtures/U.4b/corpus.json in <code conceal={false} fg={text.base}>, with the TUI's parsers registered as
// routes/session/index.tsx registers them. crates/ui/tests/grammars.rs compares opencode_ui::code::view with them.
import { addDefaultParsers } from "@opentui/core"
import parsers from "../../../tui/src/parsers-config"
import { useTheme, useThemes } from "../../../tui/src/context/theme"
import { renderComponent } from "../lib/component"

addDefaultParsers(parsers.parsers)

const corpus: Record<string, string> = await Bun.file(new URL("../fixtures/U.4b/corpus.json", import.meta.url)).json()

function Snippet(props: { filetype: string }) {
  const theme = useTheme()
  const { currentSyntax: syntax } = useThemes()
  return (
    <code
      conceal={false}
      fg={theme.text.base}
      filetype={props.filetype}
      syntaxStyle={syntax()}
      content={corpus[props.filetype]}
    />
  )
}

for (const filetype of Object.keys(corpus)) {
  const first = corpus[filetype].split("\n")[0]
  await renderComponent({
    fixture: `U.4b/${filetype}`,
    width: 60,
    height: 12,
    element: () => <Snippet filetype={filetype} />,
    ready: (frame) => frame.includes(first),
    // A grammar loads in the tree-sitter worker the first time; give it time before the frame settles again.
    act: () => Bun.sleep(1500),
  })
}
