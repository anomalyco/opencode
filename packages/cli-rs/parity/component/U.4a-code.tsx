/** @jsxImportSource @opentui/solid */
// P-COMP fixtures of highlighted code and a patch as the transcript's Write and Edit tools show them
// (routes/session/index.tsx): <code> inside <line_number>, and PatchDiff in the unified view with word wrap.
// crates/ui/tests/all/content.rs compares opencode_ui::code and opencode_ui::diff with them.
import { PatchDiff } from "../../../tui/src/component/patch-diff"
import { useTheme, useThemes } from "../../../tui/src/context/theme"
import { renderComponent } from "../lib/component"

const corpus: Record<string, string> = await Bun.file(new URL("../fixtures/U.4a/corpus.json", import.meta.url)).json()

function Code() {
  const theme = useTheme()
  const { currentSyntax: syntax } = useThemes()
  return (
    <line_number fg={theme.text.muted} minWidth={3} paddingRight={1}>
      <code conceal={false} fg={theme.text.base} filetype="typescript" syntaxStyle={syntax()} content={corpus.code} />
    </line_number>
  )
}

function Patch() {
  const theme = useTheme()
  const { currentSyntax: syntax } = useThemes()
  return (
    <box paddingLeft={1} paddingRight={3}>
      <PatchDiff
        diff={corpus.diff}
        hunkFg={theme.diff.text.hunkHeader}
        view="unified"
        filetype="typescript"
        syntaxStyle={syntax()}
        showLineNumbers={true}
        width="100%"
        wrapMode="word"
        fg={theme.text.base}
        addedBg={theme.diff.background.added}
        removedBg={theme.diff.background.removed}
        contextBg={theme.diff.background.context}
        addedSignColor={theme.diff.highlight.added}
        removedSignColor={theme.diff.highlight.removed}
        lineNumberFg={theme.diff.lineNumber.text}
        lineNumberBg={theme.diff.background.context}
        addedLineNumberBg={theme.diff.lineNumber.background.added}
        removedLineNumberBg={theme.diff.lineNumber.background.removed}
      />
    </box>
  )
}

await renderComponent({
  fixture: "U.4a/code",
  width: 60,
  height: 10,
  element: () => <Code />,
  ready: (frame) => frame.includes("steps.length"),
  // Highlighting arrives from the tree-sitter worker after the text; give it time before the frame settles again.
  act: () => Bun.sleep(500),
})

await renderComponent({
  fixture: "U.4a/diff",
  width: 60,
  height: 14,
  element: () => <Patch />,
  ready: (frame) => frame.includes("unreachable"),
  act: () => Bun.sleep(500),
})
