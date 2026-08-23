import type { Plugin } from "@opencode-ai/plugin/tui"
import { useTerminalDimensions } from "@opentui/solid"
import { createSignal, For } from "solid-js"
import { useThemes } from "../../../context/theme"
import { usePlugin } from "../../../plugin/context"
import { StoryFooter } from "./footer"
import type { Story } from "./index"

const VARIATIONS = [
  {
    title: "Startup overlap",
    description: "Elapsed seconds with overlapping work across three implementation strategies.",
    source: `gantt
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
  model answers, never calls bash :0, 4`,
  },
  {
    title: "Release dependencies",
    description: "Calendar dates, task IDs, durations, after dependencies, and a release milestone.",
    source: `gantt
  title August release train
  dateFormat YYYY-MM-DD
  axisFormat %m-%d
  section Foundation
  Freeze schema :done, schema, 2026-08-18, 2d
  Implement API :active, api, after schema, 3d
  section Release
  Regression pass :qa, after api, 2d
  Production ship :milestone, after qa, 0d`,
  },
  {
    title: "Task states",
    description: "Normal, completed, active, critical, and milestone styles on one compact timeline.",
    source: `gantt
  title Migration status
  dateFormat s
  axisFormat %Ss
  section Data plane
  Snapshot database :done, 0, 3
  Backfill records :active, 2, 9
  Verify checksums :6, 11
  section Cutover
  Stop old writes :crit, 10, 13
  Switch traffic :milestone, 13, 13
  Watch error rate :13, 17`,
  },
  {
    title: "Unsupported fallback",
    description: "Unsupported calendar exclusions stay visible as source instead of rendering an inaccurate chart.",
    source: `gantt
  title Weekend-aware release
  dateFormat YYYY-MM-DD
  axisFormat %m-%d
  excludes weekends
  section Release
  Stabilize :2026-08-21, 3d
  Ship :milestone, 2026-08-26, 0d`,
  },
] as const

function MermaidGanttStory(props: { context: Plugin.Context }) {
  const dimensions = useTerminalDimensions()
  const plugins = usePlugin()
  const themes = useThemes()
  const theme = props.context.theme.contextual.elevated
  const [selected, setSelected] = createSignal(0)
  const variation = () => VARIATIONS[selected()]
  const select = (index: number) => setSelected((index + VARIATIONS.length) % VARIATIONS.length)

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
        title: "Previous variation",
        group: "Storybook",
        run: () => select(selected() - 1),
      },
      {
        bind: "right,l",
        title: "Next variation",
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
        bind: "r",
        title: "Reset variation",
        group: "Storybook",
        run: () => select(0),
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
        <For each={[variation()]}>
          {(item) => (
            <markdown
              syntaxStyle={themes.currentSyntax()}
              content={`\`\`\`mermaid\n${item.source}\n\`\`\``}
              conceal={true}
              fg={theme.markdown.text}
              bg={theme.background.default}
              renderNode={plugins.markdown()}
            />
          )}
        </For>
      </box>
      <box flexGrow={1} />
      <StoryFooter
        context={props.context}
        title="storybook / Mermaid Gantt"
        details={[`${selected() + 1}/${VARIATIONS.length}`, `${dimensions().width}×${dimensions().height}`]}
        status={variation().title}
        controls={[
          { shortcut: "←/→", label: "variation" },
          { shortcut: "1–4", label: "select" },
          { shortcut: "r", label: "reset" },
          { shortcut: "esc", label: "back" },
        ]}
      />
    </box>
  )
}

export const mermaidGanttStory: Story = {
  id: "mermaid-gantt",
  title: "Mermaid Gantt diagrams",
  render: (context) => <MermaidGanttStory context={context} />,
}
