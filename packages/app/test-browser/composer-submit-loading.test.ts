import { expect, test } from "bun:test"
import { createRoot, createSignal } from "solid-js"
import type { ActiveComposerAdapter, ComposerSession } from "@/composer/adapter"
import { createMemoryComposerState } from "@/composer/state"
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
    selected: () => undefined,
    current: () => undefined,
    list: () => [],
    set() {},
    cycle() {},
  },
} satisfies ModelSelection

test.each([
  { name: "a send asks for a selection only once loading finds none", agent: "", toasts: ["missing"], left: "ship it" },
  { name: "editing a held send cancels it and keeps the edit", edit: "ship i", toasts: [], left: "ship i" },
  { name: "clearing a held send cancels it", edit: "", toasts: [], left: "" },
  { name: "stopping a held send cancels it and keeps the prompt", stop: true, toasts: [], left: "ship it" },
])("$name", async (row) => {
  const state = createMemoryComposerState({ prompt: "ship it" }).capture()
  const sent: string[] = []
  const toasts: string[] = []
  const [agent, setAgent] = createSignal<string>()

  const session: ComposerSession = {
    id: "session-1",
    directory: "/repo",
    handoff: { set() {}, clear() {} },
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
      mode: () => "normal",
      commands: () => [],
      editor: () => undefined,
      queueScroll() {},
      addToHistory() {},
      removeFromHistory() {},
      resetHistory() {},
      setMode() {},
      closePopover() {},
      notify: { missingSelection: () => void toasts.push("missing"), unqueueable() {}, failed() {} },
      comments: { capture: () => [], clear() {}, restore() {} },
    })

    const held = submission.submit(new Event("submit"))
    // Pressing send again while it waits neither sends twice nor asks for a selection.
    await submission.submit(new Event("submit"))

    expect(submission.held()).toBe(true)
    expect(toasts).toEqual([])

    if (row.edit !== undefined) state.set([{ type: "text", content: row.edit, start: 0, end: row.edit.length }])

    if (row.stop) await submission.stop()

    // A cancelled hold settles before loading finishes, and loading afterwards sends nothing.
    if (row.agent === undefined) {
      await held
      expect(submission.held()).toBe(false)
    }

    setAgent(row.agent ?? "build")
    await held

    expect(submission.held()).toBe(false)
    expect(toasts).toEqual(row.toasts)
    expect(sent).toEqual([])
    expect(text(state)).toBe(row.left)
    dispose()
  })
})

function text(state: ReturnType<ReturnType<typeof createMemoryComposerState>["capture"]>) {
  return state
    .current()
    .map((part) => ("content" in part ? part.content : ""))
    .join("")
}
