import { createMermaidMarkdownRenderer } from "@opencode-ai/mermaid/markdown"
import { createOpenCodeDiagramPalette } from "@opencode-ai/mermaid/palette"
import type { Plugin } from "@opencode-ai/plugin/tui"
import { useTerminalDimensions } from "@opentui/solid"
import { createMemo, createSignal, For } from "solid-js"
import { useThemes } from "../../../context/theme"
import { StoryFooter } from "./footer"
import type { Story } from "./index"

const SOURCE = `gantt
  dateFormat s
  axisFormat %Ss
  section OLD (blocking)
  provider.create (Modal sandbox) :crit, 0, 15
  model streams first token :15, 17
  section NEW (eager kick)
  reserve (DB insert) :0, 1
  model streams first token :0, 2
  provisioning in background :active, 0, 15
  model calls bash → spawn runs :15, 16
  section NEW (pure chat thread)
  reserve (DB insert) :0, 1
  model answers, never calls bash :0, 4`

const VARIATIONS = [
  {
    style: "rail",
    title: "Terminal rails",
    description: "Heavy spans with explicit start and end gates: ┣━━━━┫",
  },
  {
    style: "block",
    title: "Solid bands",
    description: "Dense duration-first bands without endpoint decoration: ██████",
  },
  {
    style: "capsule",
    title: "Open capsules",
    description: "Lighter directional spans with open caps: ╺━━━━╸",
  },
  {
    style: "points",
    title: "Boundary points",
    description: "Start and finish carry the emphasis, joined by a quiet line: ●────●",
  },
  {
    style: "track",
    title: "Full tracks",
    description: "Every task gets a complete dim lane; toggle its glyph and the active endpoints independently.",
  },
] as const

const LINES = ["heavy", "thin", "double", "dashed"] as const
const LABELS = ["right", "left", "tree"] as const
const TRACK_TONES = ["medium", "dim", "faint"] as const

function MermaidGanttStory(props: { context: Plugin.Context }) {
  const dimensions = useTerminalDimensions()
  const themes = useThemes()
  const theme = props.context.theme.contextual.elevated
  const [selected, setSelected] = createSignal(0)
  const [track, setTrack] = createSignal<"dots" | "line">("dots")
  const [endpoints, setEndpoints] = createSignal<"caps" | "points">("caps")
  const [line, setLine] = createSignal(0)
  const [labels, setLabels] = createSignal(0)
  const [sections, setSections] = createSignal<"compact" | "spaced">("compact")
  const [trackTone, setTrackTone] = createSignal(2)
  const variation = () => VARIATIONS[selected()]
  const rendering = createMemo(() => ({
    ...variation(),
    track: track(),
    endpoints: endpoints(),
    line: LINES[line()],
    labels: LABELS[labels()],
    sections: sections(),
    trackTone: TRACK_TONES[trackTone()],
  }))
  const select = (index: number) => setSelected((index + VARIATIONS.length) % VARIATIONS.length)
  const renderer = (item: ReturnType<typeof rendering>) =>
    createMermaidMarkdownRenderer(props.context.renderer, () => ({
      gantt: {
        style: item.style,
        track: item.track,
        endpoints: item.endpoints,
        line: item.line,
        labels: item.labels,
        sections: item.sections,
        trackTone: item.trackTone,
      },
      colors: createOpenCodeDiagramPalette({
        text: props.context.theme.text.default,
        subdued: props.context.theme.text.subdued,
        info: props.context.theme.text.feedback.info.default,
        success: props.context.theme.text.feedback.success.default,
        warning: props.context.theme.text.feedback.warning.default,
        background: props.context.theme.background.default,
      }),
    }))

  props.context.keymap.layer(() => ({
    commands: [
      {
        bind: "escape",
        title: "Back to storybook",
        group: "Storybook",
        run: () => props.context.ui.router.navigate({ type: "plugin", name: "storybook" }),
      },
      {
        bind: "left,h",
        title: "Previous rendering",
        group: "Storybook",
        run: () => select(selected() - 1),
      },
      {
        bind: "right",
        title: "Next rendering",
        group: "Storybook",
        run: () => select(selected() + 1),
      },
      ...VARIATIONS.map((item, index) => ({
        bind: String(index + 1),
        title: `Show ${item.title}`,
        group: "Storybook",
        run: () => select(index),
      })),
      {
        bind: "t",
        title: "Toggle track glyph",
        group: "Storybook",
        run: () => setTrack((value) => (value === "dots" ? "line" : "dots")),
      },
      {
        bind: "e",
        title: "Toggle endpoints",
        group: "Storybook",
        run: () => setEndpoints((value) => (value === "caps" ? "points" : "caps")),
      },
      {
        bind: "l",
        title: "Next line style",
        group: "Storybook",
        run: () => setLine((value) => (value + 1) % LINES.length),
      },
      {
        bind: "a",
        title: "Next label alignment",
        group: "Storybook",
        run: () => setLabels((value) => (value + 1) % LABELS.length),
      },
      {
        bind: "s",
        title: "Toggle section spacing",
        group: "Storybook",
        run: () => setSections((value) => (value === "compact" ? "spaced" : "compact")),
      },
      {
        bind: "d",
        title: "Cycle track dimness",
        group: "Storybook",
        run: () => setTrackTone((value) => (value + 1) % TRACK_TONES.length),
      },
      {
        bind: "r",
        title: "Reset rendering",
        group: "Storybook",
        run() {
          select(0)
          setTrack("dots")
          setEndpoints("caps")
          setLine(0)
          setLabels(0)
          setSections("compact")
          setTrackTone(2)
        },
      },
    ],
  }))

  return (
    <box
      width={dimensions().width}
      height={dimensions().height}
      flexDirection="column"
      backgroundColor={theme.background.default}
    >
      <box paddingTop={1} paddingLeft={2} paddingRight={2} flexDirection="column">
        <text fg={theme.text.default}>{variation().title}</text>
        <text fg={theme.text.subdued}>{variation().description}</text>
        <box height={1} />
        <For each={[rendering()]}>
          {(item) => (
            <markdown
              syntaxStyle={themes.currentSyntax()}
              content={`\`\`\`mermaid\n${SOURCE}\n\`\`\``}
              conceal={true}
              fg={theme.markdown.text}
              bg={theme.background.default}
              renderNode={renderer(item)}
            />
          )}
        </For>
      </box>
      <box flexGrow={1} />
      <StoryFooter
        context={props.context}
        title="storybook / Mermaid Gantt render lab"
        details={[`${selected() + 1}/${VARIATIONS.length}`, `${dimensions().width}×${dimensions().height}`]}
        status={`${variation().title} · ${LINES[line()]} · ${LABELS[labels()]} · ${sections()}${variation().style === "track" ? ` · ${track()} · ${TRACK_TONES[trackTone()]} · ${endpoints()}` : ""}`}
        controls={[
          { shortcut: "←/→", label: "rendering" },
          { shortcut: "1–5", label: "select" },
          { shortcut: "l", label: "line" },
          { shortcut: "t", label: "track" },
          { shortcut: "e", label: "ends" },
          { shortcut: "a", label: "labels" },
          { shortcut: "s", label: "spacing" },
          { shortcut: "d", label: "dimness" },
          { shortcut: "r", label: "reset" },
          { shortcut: "esc", label: "back" },
        ]}
      />
    </box>
  )
}

export const mermaidGanttStory: Story = {
  id: "mermaid-gantt",
  title: "Mermaid Gantt render lab",
  render: (context) => <MermaidGanttStory context={context} />,
}
