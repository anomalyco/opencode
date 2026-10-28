import { SessionQueuePanel } from "./queue-panel"
import type { SessionQueueView } from "./queue"

const prompts = [
  "Compare the Alpha and Beta fixtures",
  "Rename the Alpha export",
  "Add a Beta regression test",
  "Summarize the Alpha changes",
  "Document the Beta settings",
  "Remove the unused Alpha helper",
]

const view = (count: () => number): SessionQueueView => ({
  rows: () => prompts.slice(0, count()).map((text, index) => ({ id: `queued_${index}`, text, attachments: 0 })),
  editing: () => undefined,
  working: () => true,
  busy: () => false,
  steer: async () => undefined,
  remove: async () => undefined,
  undo: () => undefined,
  edit: () => false,
  reorder: async () => undefined,
})

export default {
  title: "OpenCode/Session/Queue panel",
  id: "session-queue-panel",
  render: (args: { count: number }) => (
    <div class="w-[560px]">
      <SessionQueuePanel queue={view(() => args.count)} />
    </div>
  ),
  args: { count: 3 },
  argTypes: { count: { control: { type: "range", min: 0, max: prompts.length, step: 1 } } },
  parameters: {
    layout: "centered",
    docs: {
      description: {
        component: "Prompts queued behind the current turn. Past four rows the list scrolls under a fade.",
      },
    },
  },
}

export const Short = { args: { count: 3 } }

export const Scrolling = { args: { count: 6 } }
