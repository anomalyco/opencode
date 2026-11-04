/** @jsxImportSource @opentui/solid */
// P-COMP fixtures of the LaTeX plugin (packages/latex/src/plugin.ts) in `TextPart`'s <markdown>
// (routes/session/message-parts.tsx): fences from packages/latex/src/markdown.test.ts, rendered, wide, and
// invalid. crates/latex/src/tests.rs renders the same documents with opencode_latex::renderer.
import { createMarkdownCodeBlockRenderer } from "@opentui/core"
import { useRenderer } from "@opentui/solid"
import { createLatexCodeBlockRenderer } from "../../../latex/src/markdown"
import { useTheme, useThemes } from "../../../tui/src/context/theme"
import { renderComponent } from "../lib/component"

const corpus: Record<string, string> = {
  structures: [
    "Before the math.",
    "```latex\n\\frac{x+1}{y-1} = \\sqrt{\\frac{1}{2}}\n```",
    "```math\n\\begin{pmatrix}a & b \\\\ c & d\\end{pmatrix}^2\n```",
    "```latex\n\\sum_{i=1}^{n} i^2 \\le \\binom{n}{k}\n```",
    "```LATEX title=example\n\\begin{cases}x & x>0\\\\x^2+1 & x\\le0\\end{cases}\n```",
    "After the math.",
  ].join("\n\n"),
  adapter: [
    "Structured math through the adapter:",
    "```latex\n\\sqrt[\\frac{1}{2}]{x}\n```",
    "```tex\n\\left\\|v\\right\\| + \\left(A\\rightarrow B\\right)\n```",
    "```latex\n\\begin{aligned}a&=b+c\\\\&=d\\end{aligned}\n```",
    "```latex\n\\displaylines{x=1\\\\y=2}\n```",
    "```latex\n\\cfrac[l]{1}{12345} \\quad \\underbrace{a+b+c}_{n}\n```",
    "```latex\n\\begin{array}{l|r}a&wide\\\\long&b\\end{array} \\text{中文}=x\n```",
  ].join("\n\n"),
  wide: "Wide:\n\n```latex\n\\text{Start a very long formula with enough content to overflow Finish}\n```\n\nEnd.",
  invalid: [
    "Invalid math stays source:",
    "```latex\n\\frac{1}{\n```",
    "```latex\n\\unsupported{x}\n```",
    "```typescript\nconst x = 2\n```",
    "Done.",
  ].join("\n\n"),
}
await Bun.write(new URL("../fixtures/P.2/corpus.json", import.meta.url), JSON.stringify(corpus, null, 2) + "\n")

function TextPart(props: { text: string }) {
  const renderer = useRenderer()
  const theme = useTheme()
  const themes = useThemes()
  const render = createLatexCodeBlockRenderer(renderer, () => ({
    text: themes.currentTokens().text.base,
    subdued: themes.currentTokens().text.muted,
  }))
  return (
    <box paddingLeft={3} flexShrink={0}>
      <markdown
        syntaxStyle={themes.currentSyntax()}
        renderNode={createMarkdownCodeBlockRenderer({ latex: render, math: render })}
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

const cases = [
  { name: "structures", width: 60, height: 30, last: "After the math." },
  { name: "adapter", width: 60, height: 36, last: "中文" },
  { name: "wide", width: 30, height: 8, last: "End." },
  { name: "invalid", width: 60, height: 20, last: "Done." },
]

for (const item of cases) {
  await renderComponent({
    fixture: `P.2/${item.name}`,
    width: item.width,
    height: item.height,
    element: () => <TextPart text={corpus[item.name]} />,
    ready: (frame) => frame.includes(item.last),
    // Code fences highlight in the tree-sitter worker after the text shows; let that land before the frame settles.
    act: () => Bun.sleep(500),
  })
}
