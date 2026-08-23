import { BackgroundMoveHint, BackgroundWorkSummary } from "./message-timeline"

const tasks = [
  { id: "task_explore", type: "subagent" as const, agent: "explore", label: "Reviewing component implementation" },
  { id: "task_status", type: "shell" as const, label: "opencode2 service status" },
  { id: "task_openapi", type: "shell" as const, label: "opencode2 api get /openapi.json" },
  { id: "task_tests", type: "shell" as const, label: "bun test packages/app" },
]

export default {
  title: "OpenCode/Session/Background work",
  id: "session-background-work",
  parameters: {
    docs: {
      description: {
        component: "Production controls for moving blocking work and inspecting active background tasks.",
      },
    },
  },
}

export const InlineMoveHint = {
  render: () => (
    <div class="flex w-[696px] max-w-full flex-col items-start gap-4">
      <BackgroundMoveHint keybind={["Ctrl", "B"]} />
    </div>
  ),
}

export const SummaryPanelEntry = {
  render: () => (
    <div class="w-[280px] rounded-[6px] bg-v2-background-bg-base px-0.5 py-1.5 shadow-[var(--v2-elevation-raised)]">
      <BackgroundWorkSummary tasks={tasks} />
    </div>
  ),
}
