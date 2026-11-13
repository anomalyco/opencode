import { createEffect, on } from "solid-js"
import { createStore } from "solid-js/store"
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

const plainRows = prompts.map((text, index) => ({ id: `queued_${index}`, text, attachments: 0 }))

const contextRows = [
  { id: "quote", text: "Update the queue context", attachments: 1 },
  { id: "notes", text: "Compare the reference notes", attachments: 2 },
  { id: "file", text: "Keep the queue compact", attachments: 1 },
  { id: "context-only", text: "", attachments: 2 },
  ...plainRows.slice(4),
]

type QueueArgs = { count: number; context: boolean; working: boolean; pending: boolean }

function QueuePreview(props: QueueArgs) {
  const rows = () => (props.context ? contextRows : plainRows).slice(0, props.count)
  const [state, setState] = createStore<{ rows: typeof plainRows; editing?: string }>({ rows: rows() })
  const remove = (id: string) => setState("rows", (rows) => rows.filter((row) => row.id !== id))

  createEffect(on(rows, (rows) => setState({ rows, editing: undefined }), { defer: true }))

  const queue: SessionQueueView = {
    rows: () => state.rows.map((row, index) => ({ ...row, pending: props.pending && index === 0 })),
    editing: () => state.editing,
    working: () => props.working,
    busy: () => props.pending,
    steer: async (id) => remove(id),
    remove: async (id) => remove(id),
    undo: remove,
    edit: (id) => {
      if (props.pending) return false
      setState("editing", id)

      return true
    },
    reorder: async (ids) =>
      void setState(
        "rows",
        ids.flatMap((id) => state.rows.filter((row) => row.id === id)),
      ),
  }

  return (
    <div class="w-[560px] max-w-full">
      <SessionQueuePanel queue={queue} />
    </div>
  )
}

export default {
  title: "OpenCode/Session/Queue panel",
  id: "session-queue-panel",
  render: (args: QueueArgs) => <QueuePreview {...args} />,
  args: { count: 3, context: false, working: true, pending: false },
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

export const WithContext = { args: { count: 4, context: true } }

export const Parked = { args: { working: false } }

export const PendingAdmission = { args: { pending: true } }
