import type { SessionStatsInfo } from "@opencode-ai/client"
import type { Plugin } from "@opencode-ai/plugin/tui"
import { createSignal } from "solid-js"
import { StatsPoster } from "../stats"
import { StoryFooter } from "./footer"
import type { Story } from "./index"

export const statsFixture: SessionStatsInfo = {
  range: { from: new Date(2026, 0, 1).getTime(), to: new Date(2026, 8, 1).getTime() },
  sessions: 685,
  subagents: 0,
  prompts: 5284,
  steps: 66731,
  tokens: { input: 461818584, output: 21883593, reasoning: 14840761, cache: { read: 8567244759, write: 119936999 } },
  cost: 0,
  tools: { mode: "none" },
  activeDays: 163,
  streak: 31,
  models: [],
  activity: Array.from({ length: 243 }, (_, index) => ({
    date: new Date(Date.UTC(2026, 0, index + 1)).toISOString().slice(0, 10),
    steps: index % 7 === 0 || index % 11 === 0 ? 0 : 1 + ((index * 97) % 1400),
  })),
}

function StatsStory(props: { context: Plugin.Context }) {
  const [empty, setEmpty] = createSignal(false)
  const stats = () =>
    empty()
      ? {
          ...statsFixture,
          sessions: 0,
          prompts: 0,
          steps: 0,
          activeDays: 0,
          streak: 0,
          activity: [],
          tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
        }
      : statsFixture
  props.context.keymap.layer(() => ({
    commands: [
      {
        bind: "escape",
        title: "Back",
        run: () => props.context.ui.router.navigate({ type: "plugin", name: "storybook" }),
      },
      { bind: "e", title: "Empty", run: () => setEmpty((value) => !value) },
      {
        bind: "r",
        title: "Reset",
        run: () => {
          setEmpty(false)
        },
      },
    ],
  }))
  return (
    <box width="100%" height="100%" backgroundColor={props.context.theme.background.default}>
      <scrollbox
        flexGrow={1}
        contentOptions={{
          alignItems: "center",
          justifyContent: "center",
          minHeight: "100%",
          paddingTop: 1,
          paddingBottom: 1,
        }}
      >
        <StatsPoster stats={stats()} />
      </scrollbox>
      <StoryFooter
        context={props.context}
        title="storybook / stats"
        controls={[
          { shortcut: "e", label: "empty" },
          { shortcut: "r", label: "reset" },
          { shortcut: "esc", label: "back" },
        ]}
      />
    </box>
  )
}

export const statsStory: Story = {
  id: "stats",
  title: "Stats poster",
  render: (context) => <StatsStory context={context} />,
}
