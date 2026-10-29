import { createSignal } from "solid-js"
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

const rows = prompts.map((text, index) => ({ id: `queued_${index}`, text, attachments: 0 }))

const view = (count: () => number): SessionQueueView => {
  const [order, setOrder] = createSignal(rows)

  return {
    rows: () => order().filter((row) => rows.indexOf(row) < count()),
    editing: () => undefined,
    working: () => true,
    busy: () => false,
    steer: async () => undefined,
    remove: async () => undefined,
    undo: () => undefined,
    edit: () => false,
    reorder: async (ids) => {
      setOrder((current) => [
        ...ids.flatMap((id) => current.filter((row) => row.id === id)),
        ...current.filter((row) => !ids.includes(row.id)),
      ])
    },
  }
}

export default {
  title: "OpenCode/Session/Queue panel",
  id: "session-queue-panel",
  render: (args: { count: number }) => {
    const queue = view(() => args.count)

    return (
      <div class="w-[560px]">
        <SessionQueuePanel queue={queue} />
      </div>
    )
  },
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
