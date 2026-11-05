import { expect, test } from "bun:test"
import { createRoot, createSignal } from "solid-js"
import type { ActiveComposerAdapter, ComposerSession } from "@/composer/adapter"
import { createMemoryComposerState } from "@/composer/state"
import { composerSubmitView } from "@/composer/machine"
import { createComposerSubmit } from "@/composer/submit"
import type { ModelSelection } from "@/providers/models/selection"

// SAFETY: submission reads only the selected model's id and provider id.
const model = { id: "model-1", provider: { id: "provider-1" } } as NonNullable<ReturnType<ModelSelection["current"]>>

const selection = {
  ready: Object.assign(() => true, { promise: undefined }),
  key: () => ({ providerID: "provider-1", modelID: "model-1" }),
  current: () => model,
  recent: () => [model],
  favorite: { list: () => [], toggle() {} },
  list: () => [model],
  cycle() {},
  set() {},
  visible: () => true,
  setVisibility() {},
  variant: {
    configured: () => undefined,
    current: () => undefined,
    list: () => [],
    set() {},
    cycle() {},
  },
} satisfies ModelSelection

test.each<{
  name: string
  mode?: "shell"
  agent?: string
  edit?: string
  stop?: boolean
  toasts: string[]
  sent: string[]
  left: string
  timeline: string[]
}>([
  {
    name: "a held prompt shows in the session at once and sends once the Location loads, keeping a new draft",
    edit: "next",
    toasts: [],
    sent: ["ship it"],
    left: "next",
    timeline: ["hold:ship it", "set:ship it"],
  },
  {
    name: "a held prompt whose Location loads without an agent returns to the composer and asks for one",
    agent: "",
    toasts: ["missing"],
    sent: [],
    left: "ship it",
    timeline: ["hold:ship it", "clear"],
  },
  {
    name: "stopping a held prompt cancels it and returns it to the composer",
    stop: true,
    toasts: [],
    sent: [],
    left: "ship it",
    timeline: ["hold:ship it", "clear"],
  },
  {
    name: "editing a held shell command cancels it and keeps the edit",
    mode: "shell",
    edit: "ship i",
    toasts: [],
    sent: [],
    left: "ship i",
    timeline: [],
  },
  {
    name: "clearing a held shell command cancels it",
    mode: "shell",
    edit: "",
    toasts: [],
    sent: [],
    left: "",
    timeline: [],
  },
])("$name", async (row) => {
  const state = createMemoryComposerState({ prompt: "ship it" }).capture()
  const sent: string[] = []
  const toasts: string[] = []
  const timeline: string[] = []
  const prompted = Promise.withResolvers<void>()
  const [agent, setAgent] = createSignal<string>()

  const session: ComposerSession = {
    id: "session-1",
    directory: "/repo",
    handoff: {
      set: (handoff) => void timeline.push(`set:${handoff.message.text}`),
      hold: (handoff) => void timeline.push(`hold:${handoff.message.text}`),
      settle() {},
      clear: () => void timeline.push("clear"),
    },
    current: () => undefined,
    admitted: () => true,
    api: {
      command: async () => undefined,
      shell: async () => undefined,
      switchAgent: async () => undefined,
      switchModel: async () => undefined,
      revert: { commit: async () => undefined },
    },
    data: {
      location: { command: { list: () => [] } },
      session: {
        prompt: async (value) => {
          sent.push(value.text)
          prompted.resolve()

          return {
            id: value.id ?? "msg_admitted",
            sessionID: value.sessionID,
            time: { created: 0 },
            type: "user" as const,
            payload: { text: value.text },
            delivery: value.delivery ?? "steer",
          }
        },
        setStatus() {},
      },
    },
  }

  const adapter: ActiveComposerAdapter = {
    kind: "active-session",
    state,
    ready: () => true,
    // Until the Location's agents load, no agent resolves and the composer reports loading.
    controls: () => ({
      agents: { available: [], options: [], current: agent() ?? "", visible: true, select() {} },
      model: { selection, paid: true, loading: agent() === undefined },
    }),
    working: () => false,
    session: () => session,
    interrupt: async () => void sent.push("interrupt"),
    submitted() {},
    setEditor() {},
  }

  await createRoot(async (dispose) => {
    const submission = createComposerSubmit({
      adapter,
      mode: () => row.mode ?? "normal",
      commands: () => [],
      editor: () => undefined,
      queueScroll() {},
      addToHistory() {},
      removeFromHistory() {},
      resetHistory() {},
      closePopover() {},
      notify: { missingSelection: () => void toasts.push("missing"), unqueueable() {}, failed() {} },
      comments: { capture: () => [], clear() {}, restore() {} },
    })

    const held = submission.submit(new Event("submit"))
    // Pressing send again while it waits neither sends twice nor asks for a selection.
    await submission.submit(new Event("submit"))

    expect(composerSubmitView(submission.state()).held).toBe(true)
    expect(toasts).toEqual([])
    // A prompt shows in the session and leaves the composer at once; a shell command waits in the composer.
    expect(text(state)).toBe(row.mode ? "ship it" : "")

    if (row.edit !== undefined) state.set([{ type: "text", content: row.edit, start: 0, end: row.edit.length }])

    if (row.stop) await submission.stop()

    // A cancelled hold settles before loading finishes, and loading afterwards sends nothing.
    if (row.edit !== undefined && row.mode) {
      await held
      expect(composerSubmitView(submission.state()).held).toBe(false)
    }

    setAgent(row.agent ?? "build")
    await held

    if (row.sent.length > 0) await prompted.promise

    expect(composerSubmitView(submission.state()).held).toBe(false)
    expect(toasts).toEqual(row.toasts)
    expect(sent).toEqual(row.sent)
    expect(text(state)).toBe(row.left)
    expect(timeline).toEqual(row.timeline)
    dispose()
  })
})

function text(state: ReturnType<ReturnType<typeof createMemoryComposerState>["capture"]>) {
  return state
    .current()
    .map((part) => ("content" in part ? part.content : ""))
    .join("")
}
