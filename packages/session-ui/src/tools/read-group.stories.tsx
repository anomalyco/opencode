import type { JsonValue, SessionMessageAssistant } from "@opencode/client/promise"
import { createSignal } from "solid-js"
import { CurrentSessionProviders } from "../storybook/current-session-story"
import { STORY_TIME } from "../storybook/current-session-fixtures"
import { storyDocument, storyTool } from "../storybook/current-session-scenarios"
import { SessionTimeline } from "../timeline/session-timeline"
import { timelinePresets } from "../timeline/detail"
import { type ContextGroupPart, CurrentContextToolGroup } from "./tool-renderer"

export default {
  title: "OpenCode/Work/Read group",
  id: "current-read-group",
  component: CurrentContextToolGroup,
  args: { width: 600 },
  argTypes: { width: { control: { type: "range", min: 280, max: 960, step: 10 } } },
}

type Read = string | [string, Record<string, JsonValue>]

// Mirrors a real exploration turn: runs of reads split by thoughts, with a few shell calls.
const steps: (Read[] | { thought: number } | { shell: string })[] = [
  ["src/index.tsx", "src/main.ts", "src/rpc.ts", "src/model.ts", "src/toolbar.tsx"],
  { thought: 4 },
  [["src/connection.ts", { limit: 120 }], "src/app/index.tsx", "src/environment.tsx", "src/env.d.ts"],
  { thought: 3 },
  ["src/components/index.tsx", "src/components/button.tsx", "src/components/toggle.ts", "src/hooks/index.tsx"],
  { thought: 4 },
  ["src/context.tsx"],
  { thought: 4 },
  [
    "src/plugin/host.ts",
    "src/plugin/surfaces.ts",
    "src/plugin/builtins.ts",
    "src/plugin/manager.ts",
    "src/plugin/module.ts",
    "src/plugin/registry.ts",
    "src/plugin/loader.ts",
  ],
  { thought: 2 },
  { shell: "bun typecheck" },
  [
    "src/session/index.ts",
    "src/session/prompt.ts",
    ["src/session/runner.ts", { offset: 200, limit: 80 }],
    "src/session/store.ts",
    "src/session/inbox.ts",
    "src/session/compaction.ts",
    "src/session/execution.ts",
    "src/session/history.ts",
    "src/session/events.ts",
    "src/session/projection.ts",
  ],
  { thought: 5 },
  [
    "src/tui/app.tsx",
    "src/tui/theme.ts",
    "src/tui/keymap.ts",
    "src/tui/layout.tsx",
    "src/tui/prompt.tsx",
    "src/tui/timeline.tsx",
    "src/tui/sidebar.tsx",
    "src/tui/dialog.tsx",
    "src/tui/toast.tsx",
    "src/tui/status.tsx",
    "src/tui/scroll.ts",
    "src/tui/input.ts",
  ],
  { shell: "git status --short" },
  { thought: 3 },
  [
    "src/server/index.ts",
    "src/server/routes.ts",
    "src/server/auth.ts",
    "src/server/cors.ts",
    "src/server/events.ts",
    "src/server/session.ts",
    "src/server/project.ts",
    "src/server/file.ts",
    "src/server/config.ts",
  ],
  { thought: 4 },
  [
    "src/config/index.ts",
    "src/config/agent.ts",
    "src/config/model.ts",
    "src/config/provider.ts",
    "src/config/permission.ts",
    "src/config/theme.ts",
    "src/config/keybind.ts",
    "src/config/mcp.ts",
    "src/config/lsp.ts",
    "src/config/formatter.ts",
    "src/config/plugin.ts",
  ],
]

const parts = steps.flatMap<ContextGroupPart>((step, index) => {
  if ("thought" in step)
    return [
      {
        type: "reasoning",
        id: `read_group_thought_${index}`,
        text: "Keep tracing where the renderer groups these tool rows before changing anything.",
        time: { created: STORY_TIME, completed: STORY_TIME + step.thought * 1000 },
      },
    ]

  if ("shell" in step)
    return [storyTool(`read_group_shell_${index}`, "shell", "completed", { command: step.shell }, { output: "ok" })]

  return step.map((read, item) => {
    const [path, args] = typeof read === "string" ? [read, {}] : read

    return storyTool(`read_group_read_${index}_${item}`, "read", "completed", { path, ...args })
  })
})

const content = parts.flatMap<SessionMessageAssistant["content"][number]>((part) => {
  if (part.type === "tool") return [part]

  if (part.type === "reasoning") return [{ type: "reasoning", text: part.text, time: part.time }]

  return []
})

export const UsedGroup = {
  render: (args: { width: number }) => {
    const [open, setOpen] = createSignal(true)

    return (
      <section style={{ width: "100%", "max-width": `${args.width}px`, padding: "16px" }}>
        <CurrentSessionProviders document={storyDocument(content)}>
          <CurrentContextToolGroup parts={parts} busy={false} open={open()} onOpenChange={setOpen} />
        </CurrentSessionProviders>
      </section>
    )
  },
}

export const WithoutUsedGroup = {
  render: (args: { width: number }) => {
    const document = storyDocument(content)

    return (
      <section style={{ width: "100%", "max-width": `${args.width}px`, padding: "16px" }}>
        <CurrentSessionProviders document={document}>
          <SessionTimeline document={document} timelineDetail={timelinePresets[0].value} />
        </CurrentSessionProviders>
      </section>
    )
  },
}
