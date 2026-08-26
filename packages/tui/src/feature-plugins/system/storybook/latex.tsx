import type { Plugin } from "@opencode-ai/plugin/tui"
import { createMarkdownCodeBlockRenderer } from "@opentui/core"
import { useTerminalDimensions } from "@opentui/solid"
import { createEffect, createMemo, createSignal, onCleanup } from "solid-js"
import { useTheme, useThemes } from "../../../context/theme"
import { createLatexCodeBlockRenderer } from "@opencode-ai/latex/markdown"
import type { Story } from "./index"
import { StoryFooter } from "./footer"

const fixtures = [
  {
    title: "Quadratic formula",
    source: String.raw`x = \frac{-b \pm \sqrt{b^2 - 4ac}}{2a}`,
  },
  {
    title: "Matrix",
    source: String.raw`A = \begin{pmatrix}a & b \\ c & d\end{pmatrix}`,
  },
  {
    title: "Piecewise function",
    source: String.raw`|x| = \begin{cases}x & x \ge 0 \\ -x & x < 0\end{cases}`,
  },
  {
    title: "Aligned equations",
    source: String.raw`\begin{aligned}(a+b)^2 &= a^2+2ab+b^2 \\ (a-b)^2 &= a^2-2ab+b^2\end{aligned}`,
  },
  {
    title: "Limit",
    source: String.raw`\lim_{n\to\infty}\left(1+\frac{1}{n}\right)^n=e`,
  },
  {
    title: "Wide expression (scroll horizontally)",
    source: String.raw`\frac{a_1+b_1}{c_1+d_1}+\frac{a_2+b_2}{c_2+d_2}+\frac{a_3+b_3}{c_3+d_3}+\frac{a_4+b_4}{c_4+d_4}+\frac{a_5+b_5}{c_5+d_5}=\text{Result}`,
  },
  {
    title: "Unsupported command stays as source",
    source: String.raw`\unsupported{x}`,
  },
]

function LatexStory(props: { context: Plugin.Context }) {
  const dimensions = useTerminalDimensions()
  const theme = useTheme()
  const themes = useThemes()
  const [selected, setSelected] = createSignal(0)
  const [length, setLength] = createSignal<number>()
  const render = createMarkdownCodeBlockRenderer({
    latex: createLatexCodeBlockRenderer(props.context.renderer, () => ({
      text: theme.text.default,
      subdued: theme.text.subdued,
    })),
  })
  const fixture = createMemo(() => fixtures[selected()])
  const source = createMemo(() => fixture().source.slice(0, length()))
  const streaming = createMemo(() => source().length < fixture().source.length)
  const markdown = createMemo(() => `\`\`\`latex\n${source()}${streaming() ? "" : "\n```"}`)

  createEffect(() => {
    const current = length()
    if (current === undefined || current >= fixture().source.length) return
    const timer = setTimeout(() => setLength(current + 4), 80)
    onCleanup(() => clearTimeout(timer))
  })

  props.context.keymap.layer(() => ({
    commands: [
      {
        bind: "escape",
        title: "Back to storybook",
        run: () => props.context.ui.router.navigate({ type: "plugin", name: "storybook" }),
      },
      {
        bind: "n",
        title: "Next formula",
        run: () => {
          setSelected((current) => (current + 1) % fixtures.length)
          setLength(undefined)
        },
      },
      { bind: "s", title: "Replay streaming", run: () => setLength(0) },
      { bind: "f", title: "Finish streaming", run: () => setLength(undefined) },
      {
        bind: "r",
        title: "Reset fixture",
        run: () => {
          setSelected(0)
          setLength(undefined)
        },
      },
    ],
  }))

  return (
    <box width={dimensions().width} height={dimensions().height} backgroundColor={theme.background.default}>
      <scrollbox flexGrow={1} minHeight={0} viewportOptions={{ paddingRight: 1 }}>
        <box padding={2} gap={1}>
          <text fg={theme.text.default}>{fixture().title}</text>
          <text fg={theme.text.subdued} wrapMode="word">
            <span style={{ fg: streaming() ? theme.text.default : theme.text.subdued }}>{source()}</span>
            <span>{fixture().source.slice(source().length)}</span>
          </text>
          <text fg={theme.text.subdued}>Unicode rendering</text>
          <markdown
            width="100%"
            content={markdown()}
            streaming={streaming()}
            syntaxStyle={themes.currentSyntax()}
            internalBlockMode="top-level"
            conceal={true}
            fg={theme.markdown.text}
            bg={theme.background.default}
            renderNode={render}
          />
        </box>
      </scrollbox>
      <StoryFooter
        context={props.context}
        title="storybook / LaTeX"
        details={[`${selected() + 1}/${fixtures.length}`, `${dimensions().width}x${dimensions().height}`]}
        status={streaming() ? `Streaming ${source().length}/${fixture().source.length}` : "Complete"}
        controls={[
          { shortcut: "n", label: "next" },
          { shortcut: "s", label: "replay" },
          { shortcut: "f", label: "finish" },
          { shortcut: "r", label: "reset" },
          { shortcut: "esc", label: "back" },
        ]}
      />
    </box>
  )
}

export const latexStory: Story = {
  id: "latex",
  title: "LaTeX math",
  render: (context) => <LatexStory context={context} />,
}
