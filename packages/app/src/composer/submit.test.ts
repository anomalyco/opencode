import { describe, expect, jest, test } from "bun:test"
import type { ModelSelection } from "@/providers/models/selection"
import type { SessionMessageHandoff } from "@/session/handoff"
import { Skill } from "@opencode/schema/skill"
import type {
  ActiveComposerAdapter,
  ComposerControls,
  ComposerDelivery,
  ComposerSession,
  NewSessionComposerAdapter,
} from "./adapter"
import { createMemoryComposerState, type Prompt } from "./state"
import { composerSubmitView } from "./machine"
import { createComposerSubmit } from "./submit"
import { createSteerBackground } from "@/session/requests/steer-background"
import { setMediaBlobLoader } from "@/runtime/persistence/drafts"
import type { ComposerStateTarget } from "./submission-state"

// SAFETY: submission reads only the selected model's id, name, and provider id.
const selectedModel = {
  id: "model-1",
  name: "Model 1",
  provider: { id: "provider-1" },
} as NonNullable<ReturnType<ModelSelection["current"]>>

const selection = {
  ready: Object.assign(() => true, { promise: undefined }),
  key: () => ({ providerID: "provider-1", modelID: "model-1" }),
  current: () => selectedModel,
  recent: () => [selectedModel],
  favorite: { list: () => [], toggle() {} },
  list: () => [selectedModel],
  cycle() {},
  set() {},
  visible: () => true,
  setVisibility() {},
  variant: {
    configured: () => undefined,
    current: () => "balanced",
    list: () => ["balanced"],
    set() {},
    cycle() {},
  },
} satisfies ModelSelection

function controls(): ComposerControls {
  return {
    agents: {
      available: [{ name: "build", mode: "primary" }],
      options: ["build"],
      current: "build",
      visible: true,
      select() {},
    },
    model: { selection, paid: true, loading: false },
  }
}

function active(state: ComposerStateTarget, target: ComposerSession, ctl = controls): ActiveComposerAdapter {
  return {
    kind: "active-session",
    state,
    ready: () => true,
    controls: ctl,
    working: () => false,
    session: () => target,
    interrupt: async () => undefined,
    submitted() {},
    setEditor() {},
  }
}

function fresh(state: ComposerStateTarget, start: NewSessionComposerAdapter["start"]): NewSessionComposerAdapter {
  return { kind: "new-session", state, ready: () => true, controls, working: () => false, submitted() {}, start }
}

function submitInput(
  adapter: ActiveComposerAdapter | NewSessionComposerAdapter,
  notify: Parameters<typeof createComposerSubmit>[0]["notify"] = {
    missingSelection() {},
    unqueueable() {},
    failed() {},
  },
  mode: "normal" | "shell" = "normal",
  commands: () => readonly { name: string }[] | undefined = () => [],
  history: string[] = [],
  clientCommand?: (text: string) => (() => void | Promise<void>) | undefined,
  delivery: (alternate: boolean) => ComposerDelivery = () => "steer",
) {
  return createComposerSubmit({
    adapter,
    mode: () => mode,
    commands,
    clientCommand,
    delivery,
    editor: () => undefined,
    queueScroll() {},
    addToHistory: (prompt) =>
      history.push(`add:${prompt.map((part) => ("content" in part ? part.content : part.type)).join("")}`),
    removeFromHistory: (prompt) =>
      history.push(`remove:${prompt.map((part) => ("content" in part ? part.content : part.type)).join("")}`),
    resetHistory() {},
    closePopover() {},
    notify,
    comments: { capture: () => [], clear() {}, restore() {} },
  })
}

const sessions = { count: 0 }

function session(input: {
  calls: string[]
  prompt?: (value: Parameters<ComposerSession["data"]["session"]["prompt"]>[0]) => Promise<void>
  handoff?: ComposerSession["handoff"]
  statuses?: ("idle" | "running")[]
  current?: ComposerSession["current"]
  admitted?: (messageID: string) => boolean
  shell?: ComposerSession["api"]["shell"]
  command?: ComposerSession["api"]["command"]
  switchAgent?: ComposerSession["api"]["switchAgent"]
  switchModel?: ComposerSession["api"]["switchModel"]
  background?: ComposerSession["background"]
  accept?: () => void
}): ComposerSession {
  return {
    // Unique per test: what this client knows about a session outlives the test that sent to it.
    id: `session-${++sessions.count}`,
    background: input.background,
    directory: "C:/repo",
    handoff: input.handoff ?? { set() {}, hold() {}, settle() {}, clear() {} },
    current: input.current ?? (() => undefined),
    admitted: input.admitted ?? (() => false),
    api: {
      switchAgent:
        input.switchAgent ??
        (async () => {
          input.calls.push("switch-agent")
        }),
      switchModel:
        input.switchModel ??
        (async () => {
          input.calls.push("switch-model")
        }),
      shell:
        input.shell ??
        (async () => {
          input.calls.push("shell")
        }),
      command: input.command ?? (async () => undefined),
      revert: {
        commit: async () => {
          input.calls.push("revert-commit")
        },
      },
    },
    file: { list: async () => ({ data: [{ path: "src/api.ts" }] }) },
    data: {
      location: { command: { list: () => [] } },
      session: {
        setStatus: (_sessionID, status) => input.statuses?.push(status),
        acceptSend: () => {
          input.calls.push("accept-send")
          input.accept?.()
        },
        // Like the data layer: admit locally, prepare, then send.
        prompt: async (value) => {
          input.calls.push("admit")
          await value.prepare?.()
          input.calls.push("send")
          await input.prompt?.(value)

          // The admitted inbox item, as the server returns it.
          return {
            id: value.id ?? "msg_admitted",
            sessionID: value.sessionID,
            time: { created: 0 },
            type: "user" as const,
            payload: { text: value.text },
            delivery: value.delivery ?? "steer",
          }
        },
      },
    },
  }
}

function text(state: ComposerStateTarget) {
  return state
    .current()
    .map((part) => ("content" in part ? part.content : ""))
    .join("")
}

describe("Composer submission", () => {
  test("retains the submitting session before waiting for server admission", async () => {
    const calls: string[] = []

    const admitted = Promise.withResolvers<void>()

    const state = createMemoryComposerState({ prompt: "Hello" }).capture()

    const adapter = {
      ...active(state, session({ calls, prompt: () => admitted.promise })),
      beforeSubmit: () => calls.push("keep-preview"),
    }

    const submitted = submitInput(adapter).submit(new Event("submit"))

    expect(calls).toEqual(["keep-preview"])
    await submitted
    admitted.resolve()
    expect(calls[0]).toBe("keep-preview")
    expect(calls).toContain("admit")
  })

  test("marks the session accepted only once the send is admitted", async () => {
    const calls: string[] = []
    const accepted = Promise.withResolvers<void>()
    const state = createMemoryComposerState({ prompt: "Hello" }).capture()

    await submitInput(active(state, session({ calls, accept: () => accepted.resolve() }))).submit(
      new Event("submit"),
    )
    await accepted.promise

    expect(calls.filter((call) => call === "accept-send")).toHaveLength(1)
  })

  test("an empty submit does not retain a preview", async () => {
    const calls: string[] = []

    const state = createMemoryComposerState().capture()

    const adapter = {
      ...active(state, session({ calls })),
      beforeSubmit: () => calls.push("keep-preview"),
    }

    await submitInput(adapter).submit(new Event("submit"))
    expect(calls).toEqual([])
  })

  test("pressing Enter and then Send while an image attachment resolves sends the prompt once", async () => {
    const state = createMemoryComposerState({ prompt: "ship it" }).capture()
    const id = `media:${"a".repeat(64)}`
    state.set([
      ...state.current(),
      { type: "image", id, filename: "shot.png", mime: "image/png", blob: { id, url: "" } },
    ])
    // The image's bytes load through the media loader, which answers only when the test lets it.
    const loaded = Promise.withResolvers<string | undefined>()
    setMediaBlobLoader("composer-double-submit", () => loaded.promise)
    const handoffs: SessionMessageHandoff[] = []

    const calls: string[] = []

    const submission = submitInput({
      ...active(
        state,
        session({ calls, handoff: { set: (handoff) => handoffs.push(handoff), hold() {}, settle() {}, clear() {} } }),
      ),
      beforeSubmit: () => calls.push("keep-preview"),
    })

    const enter = submission.submit(new Event("submit"))
    const send = submission.submit(new Event("submit"))

    expect(calls).toEqual(["keep-preview"])
    loaded.resolve("data:image/png;base64,YQ==")
    await Promise.all([enter, send])
    setMediaBlobLoader("composer-double-submit", undefined)

    expect(handoffs.map((handoff) => handoff.message.text)).toEqual(["ship it"])
    expect(state.current()).toEqual([{ type: "text", content: "", start: 0, end: 0 }])
  })

  test.each(["steer", "queue"] as const)(
    "sends only the selected quote as a %s, including its comment mentions, without clearing the draft",
    async (delivery) => {
      const state = createMemoryComposerState({ prompt: "/review keep this draft" }).capture()

      const image = {
        type: "image" as const,
        id: "unrelated-image",
        filename: "draft.png",
        mime: "image/png",
        blob: { id: "unrelated-image", url: "data:image/png;base64,YQ==" },
      }

      state.set([...state.current(), image], 5)
      state.mode.set("shell")
      state.context.add({ type: "quote", text: "Selected passage", commentID: "selected", comment: "Old comment" })
      state.context.add({ type: "quote", text: "Unrelated passage", commentID: "other" })
      state.context.add({ type: "file", path: "unrelated.ts" })
      const before = state.current()

      const requests: Parameters<ComposerSession["data"]["session"]["prompt"]>[0][] = []

      const calls: string[] = []

      const submission = submitInput(
        {
          ...active(state, session({ calls, prompt: async (value) => void requests.push(value) })),
          beforeSubmit: () => calls.push("keep-preview"),
        },
        undefined,
        "shell",
        undefined,
        undefined,
        undefined,
        (alternate) => {
          expect(alternate).toBe(true)

          return delivery
        },
      )

      expect(await submission.submitQuote("quote:c=selected", "Compare @src/api.ts with @here")).toBe(true)
      expect(calls[0]).toBe("keep-preview")
      expect(requests).toHaveLength(1)
      expect(requests[0]?.text).toBe(
        "The user quoted the following from earlier in the conversation:\n> Selected passage\n\nThe user made the following comment regarding this quote: Compare @src/api.ts with @here",
      )
      expect(requests[0]).toMatchObject({
        delivery,
        files: [{ uri: "file:///C:/repo/src/api.ts", name: "api.ts" }],
        agents: [],
        skills: [],
        metadata: {
          displayText: "",
          comments: [{ type: "quote", text: "Selected passage", comment: "Compare @src/api.ts with @here" }],
          attachments: [],
        },
      })
      expect(state.current()).toBe(before)
      expect(state.cursor()).toBe(5)
      expect(state.mode.current()).toBe("shell")
      expect(state.context.items().map((item) => item.key)).toEqual([
        "quote:c=other",
        "file:unrelated.ts:undefined:undefined",
      ])
    },
  )

  test("a failed quote send retains its latest comment and prevents duplicate submissions while pending", async () => {
    const state = createMemoryComposerState({ prompt: "Keep this draft" }).capture()

    state.context.add({ type: "quote", text: "Selected passage", commentID: "selected" })
    const failed = Promise.withResolvers<void>()

    const started = Promise.withResolvers<void>()

    const errors: string[] = []

    const calls: string[] = []

    const submission = submitInput(
      active(
        state,
        session({
          calls,
          prompt: async () => {
            started.resolve()
            await failed.promise
          },
        }),
      ),
      { missingSelection() {}, unqueueable() {}, failed: (_kind, error) => void errors.push(String(error)) },
    )

    const pending = submission.submitQuote("quote:c=selected", "Latest comment")

    await started.promise
    expect(await submission.submitQuote("quote:c=selected", "Duplicate")).toBe(false)
    failed.reject(new Error("Could not send"))
    expect(await pending).toBe(false)
    expect(errors).toHaveLength(1)
    expect(state.current()).toEqual([{ type: "text", content: "Keep this draft", start: 0, end: 15 }])
    expect(state.context.items()).toMatchObject([
      { key: "quote:c=selected", text: "Selected passage", comment: "Latest comment" },
    ])
    expect(calls.filter((call) => call === "send")).toHaveLength(2)
  })

  test("a quote send keeps sending while the composer sends it, and fails only once the composer can retry", async () => {
    const state = createMemoryComposerState().capture()
    state.context.add({ type: "quote", text: "Selected passage", commentID: "selected" })
    const release = Promise.withResolvers<void>()
    const failed = Promise.withResolvers<void>()

    const submission = submitInput(active(state, session({ calls: [], prompt: () => release.promise })), {
      missingSelection() {},
      unqueueable() {},
      failed: () => failed.resolve(),
    })

    jest.useFakeTimers()
    state.quoteComment.set("quote:c=selected")
    state.quoteComment.send("note", submission.submitQuote)
    // A silent server holds a prompt for a minute per attempt; the send has not failed until the composer says so.
    jest.advanceTimersByTime(5 * 60_000)
    jest.useRealTimers()
    expect(state.quoteComment.state()).toMatchObject({ status: "sending", draft: "note" })
    expect(composerSubmitView(submission.state()).canSubmit).toBe(false)

    release.reject(new Error("offline"))
    await failed.promise
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(state.quoteComment.state()).toMatchObject({ status: "failed", draft: "note" })
    expect(composerSubmitView(submission.state()).canSubmit).toBe(true)
  })

  test("a prompt that fails after a newer one went out leaves the Session running", async () => {
    const state = createMemoryComposerState({ prompt: "first" }).capture()
    const statuses: ("idle" | "running")[] = []
    const first = Promise.withResolvers<void>()
    const second = Promise.withResolvers<void>()
    const failed = { count: 0, settled: Promise.withResolvers<void>() }

    const target = session({
      calls: [],
      statuses,
      prompt: async (value) => {
        if (value.text === "first") return first.promise
        await second.promise
      },
    })

    const submission = submitInput(
      { ...active(state, target), working: () => statuses.at(-1) === "running" },
      {
        missingSelection() {},
        unqueueable() {},
        failed: () => {
          failed.count++
          failed.settled.resolve()
        },
      },
    )

    await submission.submit(new Event("submit"))
    state.set([{ type: "text", content: "second", start: 0, end: 6 }])
    await submission.submit(new Event("submit"))
    first.reject(new Error("offline"))
    await failed.settled.promise
    // The second prompt's turn may already run; only the server's events may end it.
    expect(statuses).toEqual(["running"])

    failed.settled = Promise.withResolvers<void>()
    second.reject(new Error("offline"))
    await failed.settled.promise
    expect(failed.count).toBe(2)
    expect(statuses).toEqual(["running", "idle"])
  })

  test("resends a failed prompt under its ID only while what it sends is unchanged", async () => {
    const state = createMemoryComposerState({ prompt: "ship it" }).capture()

    const note = {
      type: "note" as const,
      origin: "browser",
      label: "button#save",
      icon: "select-element",
      subject: 'the "button#save" element',
      live: { subject: 'the "button#save" element (browser ref @e42)' },
      comment: "Rename this",
      commentID: "note",
    }

    state.context.add(note)
    const sent: string[] = []
    const run = { fail: true, queued: false, settled: Promise.withResolvers<void>() }

    const submission = submitInput(
      active(
        state,
        session({
          calls: [],
          prompt: async (value) => {
            sent.push(value.id ?? "")

            if (run.fail) throw new Error("offline")
            run.settled.resolve()
          },
        }),
      ),
      { missingSelection() {}, unqueueable() {}, failed: () => run.settled.resolve() },
      "normal",
      undefined,
      undefined,
      undefined,
      () => (run.queued ? "queue" : "steer"),
    )

    const send = async () => {
      run.settled = Promise.withResolvers<void>()
      sent.length = 0
      await submission.submit(new Event("submit"))
      await run.settled.promise

      return sent[0]
    }

    const first = await send()
    expect(state.retry.current()).toMatchObject({ id: first })
    expect(await send()).toBe(first)

    // The browser plugin re-picked the element, so the note now names another ref.
    state.context.replaceComments([{ ...note, live: { subject: 'the "button#save" element (browser ref @e7)' } }])
    const edited = await send()
    expect(edited).not.toBe(first)

    run.queued = true
    const queued = await send()
    expect(queued).not.toBe(edited)

    run.fail = false
    expect(await send()).toBe(queued)
    expect(state.retry.current()).toBeUndefined()
  })

  test("an unedited resend after a failed send keeps its ID and its file order", async () => {
    const state = createMemoryComposerState({ prompt: "review these" }).capture()
    state.context.add({ type: "file", path: "src/a.ts" })
    state.context.add({ type: "file", path: "src/b.ts", comment: "Check this", commentID: "b" })
    const keys = state.context.items().map((item) => item.key)
    const sent: string[] = []
    const failed = { settled: Promise.withResolvers<void>() }

    const submission = submitInput(
      active(
        state,
        session({
          calls: [],
          prompt: async (value) => {
            sent.push(value.id ?? "")
            throw new Error("offline")
          },
        }),
      ),
      { missingSelection() {}, unqueueable() {}, failed: () => failed.settled.resolve() },
    )

    const send = async () => {
      failed.settled = Promise.withResolvers<void>()
      sent.length = 0
      await submission.submit(new Event("submit"))
      await failed.settled.promise

      return sent[0]
    }

    const first = await send()
    // Restoring used to list the commented file first, so the resend fingerprinted differently and took a new ID.
    expect(state.context.items().map((item) => item.key)).toEqual(keys)
    expect(await send()).toBe(first)
  })

  test("a failed server command restores its draft without a retry ID, which it never sent", async () => {
    const state = createMemoryComposerState({ prompt: "/review" }).capture()
    const failed = Promise.withResolvers<void>()

    await submitInput(
      active(
        state,
        session({
          calls: [],
          command: async () => {
            throw new Error("offline")
          },
        }),
      ),
      { missingSelection() {}, unqueueable() {}, failed: () => failed.resolve() },
      "normal",
      () => [{ name: "review" }],
    ).submit(new Event("submit"))
    await failed.promise

    expect(text(state)).toBe("/review")
    expect(state.retry.current()).toBeUndefined()
  })

  test("applies the selection and runs a client argument command without admitting it to the session", async () => {
    const state = createMemoryComposerState().capture()

    const image = {
      type: "image" as const,
      id: "attachment",
      filename: "diagram.png",
      mime: "image/png",
      blob: { id: "attachment", url: "data:image/png;base64,YQ==" },
    }

    state.set([{ type: "text", content: "/btw why this approach?", start: 0, end: 23 }, image])
    state.context.add({ type: "file", path: "src/retry.ts" })
    const calls: string[] = []
    const history: string[] = []

    await submitInput(
      { ...active(state, session({ calls })), beforeSubmit: () => calls.push("keep-preview") },
      undefined,
      "normal",
      undefined,
      history,
      (text) => {
        expect(text).toBe("/btw why this approach?")

        return () => {
          calls.push("btw")
        }
      },
    ).submit(new Event("submit"))

    // Client commands such as /btw generate with the session's model, so the composer's selection commits first.
    expect(calls).toEqual(["keep-preview", "switch-agent", "switch-model", "btw"])
    expect(history).toEqual([])
    expect(state.current()).toEqual([{ type: "text", content: "", start: 0, end: 0 }, image])
    expect(state.context.items()).toHaveLength(1)
  })

  test.each([
    // The prompt admits before the selection commits, so a steer shows as pending while it does.
    {
      current: { agent: "plan", model: { id: "old", providerID: "old" } },
      calls: ["admit", "switch-agent", "switch-model", "send"],
    },
    // An unchanged selection sends without a model request to wait on.
    {
      current: { agent: "build", model: { providerID: "provider-1", id: "model-1", variant: "balanced" } },
      calls: ["admit", "send"],
    },
    // A prompt commits a staged revert, which would delete the model switch made after its boundary. The revert
    // settles before admission, whose row it would also delete.
    {
      current: { agent: "plan", model: { id: "old", providerID: "old" }, revert: { messageID: "msg_reverted" } },
      calls: ["switch-agent", "revert-commit", "switch-model", "admit", "send"],
    },
  ])("applies the selection before sending one captured value: $calls", async (row) => {
    const state = createMemoryComposerState({ prompt: "ship it" }).capture()
    state.context.add({ type: "file", path: "notes.md", description: "the failing version" })
    const calls: string[] = []
    const admitted = Promise.withResolvers<Parameters<ComposerSession["data"]["session"]["prompt"]>[0]>()
    const target = session({ calls, current: () => row.current, prompt: async (value) => admitted.resolve(value) })

    await submitInput(active(state, target)).submit(new Event("submit"))
    const request = await admitted.promise

    expect(calls).toEqual([...row.calls])
    expect(request.delivery).toBe("steer")
    expect(request.text).toBe("ship it")
    expect(request.id).toMatch(/^msg_/)
    expect(request.metadata).toMatchObject({
      displayText: "ship it",
      agent: "build",
      model: { providerID: "provider-1", modelID: "model-1", variant: "balanced" },
    })
    // A file chip goes with this prompt only, like the TUI's mentionless files.
    expect(request.files).toMatchObject([{ name: "notes.md", description: "the failing version" }])
    expect(request.files?.[0]?.mention).toBeUndefined()
    expect(state.current()).toEqual([{ type: "text", content: "", start: 0, end: 0 }])
    expect(state.context.items()).toEqual([])
  })

  test.each(["", "Align these targets"])("hands off and admits uncommented notes with instruction %j", async (text) => {
    const draft = createMemoryComposerState({ prompt: text }).capture()

    const notes = [
      {
        type: "note" as const,
        origin: "example",
        label: "Save",
        title: "button#save",
        subtitle: "Browser annotation",
        icon: "select-element",
        subject: 'the "Save" element',
        href: "example:save",
        live: { subject: 'the "Save" element (live reference @e42)', href: "example:save#e42" },
        comment: "",
      },
      {
        type: "note" as const,
        origin: "another-plugin",
        label: "Cancel",
        icon: "select-element",
        subject: 'the "Cancel" element',
        comment: "",
      },
    ]

    notes.forEach((note, index) => draft.context.add({ ...note, commentID: `${index}` }))
    const handoffs: SessionMessageHandoff[] = []
    const first: Parameters<NewSessionComposerAdapter["start"]>[2][] = []
    const admitted = Promise.withResolvers<Parameters<ComposerSession["data"]["session"]["prompt"]>[0]>()
    const calls: string[] = []

    const target = session({
      calls,
      handoff: { set: (value) => handoffs.push(value), hold() {}, settle() {}, clear() {} },
      prompt: async (value) => admitted.resolve(value),
    })

    await submitInput(
      fresh(draft, async (_selection, _submission, message) => {
        first.push(message)

        return { session: target, cleanupReady: Promise.resolve() }
      }),
    ).submit(new Event("submit"))

    expect(calls).toContain("admit")
    const request = await admitted.promise
    expect(request.metadata).toMatchObject({ displayText: text, comments: notes })
    expect(first).toMatchObject([{ text, metadata: { displayText: text, comments: notes } }])
    expect(handoffs).toMatchObject([{ message: { text, metadata: { displayText: text, comments: notes } } }])
    expect(draft.context.items()).toEqual([])
  })

  test.each(["steer", "queue"] as const)(
    "shows a %s in the session as the composer clears, before its selection commits",
    async (delivery) => {
      const state = createMemoryComposerState({ prompt: "ship it" }).capture()
      const committed = Promise.withResolvers<void>()
      const handoffs: SessionMessageHandoff[] = []
      const statuses: ("idle" | "running")[] = []

      const target = session({
        calls: [],
        statuses,
        handoff: { set: (handoff) => handoffs.push(handoff), hold() {}, settle() {}, clear() {} },
        switchModel: async () => committed.promise,
      })

      await submitInput(
        active(state, target),
        undefined,
        "normal",
        undefined,
        undefined,
        undefined,
        () => delivery,
      ).submit(new Event("submit"))

      expect(state.current()).toEqual([{ type: "text", content: "", start: 0, end: 0 }])
      expect(statuses).toEqual(["running"])
      // A queued prompt shows in the queue once admitted, not in the transcript.
      expect(handoffs).toMatchObject(
        delivery === "steer"
          ? [
              {
                message: { type: "user", text: "ship it" },
                selection: { agent: "build", model: { id: "model-1", providerID: "provider-1", variant: "balanced" } },
              },
            ]
          : [],
      )
      committed.resolve()
    },
  )

  test("applies the captured agent and model before a custom command without passing over its overrides", async () => {
    const state = createMemoryComposerState({ prompt: "/review changes" }).capture()
    const calls: string[] = []
    const selected = controls()
    const agent = Promise.withResolvers<void>()
    const started = Promise.withResolvers<void>()
    const committed = Promise.withResolvers<void>()
    const completed = Promise.withResolvers<void>()

    const target = session({
      calls,
      switchAgent: async (request) => {
        expect(request.agent).toBe("build")
        calls.push("agent")
        started.resolve()
        await agent.promise
      },
      switchModel: async (request) => {
        expect(request.model).toEqual({ providerID: "provider-1", id: "model-1", variant: "balanced" })
        calls.push("model")
        await committed.promise
      },
      command: async (request) => {
        expect(request).toMatchObject({ name: "review", text: "changes", delivery: "steer" })
        expect(request).not.toHaveProperty("model")
        expect(request).not.toHaveProperty("agent")
        calls.push("command")
        completed.resolve()
      },
    })

    selected.model.selection = {
      ...selection,
      trackSessionCommit: (_id, value) => {
        expect(value).toEqual({
          agent: "build",
          model: { providerID: "provider-1", modelID: "model-1" },
          variant: "balanced",
        })
        calls.push("track")

        return () => calls.push("cancel")
      },
    }
    await submitInput(
      active(state, target, () => selected),
      undefined,
      "normal",
      () => [{ name: "review" }],
    ).submit(new Event("submit"))
    await started.promise
    expect(calls).toEqual(["track", "agent"])
    selected.agents.current = "plan"
    selected.model.selection = { ...selection, variant: { ...selection.variant, current: () => "high" } }
    agent.resolve()
    committed.resolve()
    await completed.promise
    expect(calls).toEqual(["track", "agent", "model", "command"])
  })

  test("cancels selection tracking and does not execute a command when selection fails", async () => {
    const state = createMemoryComposerState({ prompt: "/review changes" }).capture()
    const calls: string[] = []
    const selected = controls()
    const failed = Promise.withResolvers<unknown>()
    const error = new Error("model unavailable")

    const target = session({
      calls,
      switchModel: async () => {
        throw error
      },
      command: async () => {
        calls.push("command")
      },
    })

    selected.model.selection = {
      ...selection,
      trackSessionCommit: () => {
        calls.push("track")

        return () => {
          calls.push("cancel")
        }
      },
    }
    await submitInput(
      active(state, target, () => selected),
      { missingSelection() {}, unqueueable() {}, failed: (_kind, error) => failed.resolve(error) },
      "normal",
      () => [{ name: "review" }],
    ).submit(new Event("submit"))
    expect(await failed.promise).toBe(error)
    expect(calls).toEqual(["track", "switch-agent", "cancel"])
    expect(state.current()[0]).toMatchObject({ content: "/review changes" })
  })

  test("restores and retries an unacknowledged admission", async () => {
    const state = createMemoryComposerState().capture()

    const prompt: Prompt = [
      { type: "text", content: "retry ", start: 0, end: 6 },
      { type: "file", path: "src/app.ts", content: "@src/app.ts", start: 6, end: 17 },
      {
        type: "image",
        id: "attachment",
        filename: "image.png",
        mime: "image/png",
        blob: { id: "attachment", url: "data:image/png;base64,YQ==" },
      },
    ]

    state.set(prompt)
    state.context.add({ type: "file", path: "notes.md", description: "the failing version" })

    const note = {
      type: "note" as const,
      origin: "example",
      label: "Target",
      title: "#target",
      subtitle: "Browser annotation",
      icon: "select-element",
      subject: "the target",
      live: { subject: "the live target" },
      comment: "",
      commentID: "target",
    }

    state.context.add(note)
    const attempts: string[] = []
    const calls: string[] = []
    const statuses: ("idle" | "running")[] = []
    const first = Promise.withResolvers<void>()
    const second = Promise.withResolvers<void>()

    const target = session({
      calls,
      statuses,
      prompt: async (value) => {
        attempts.push(value.id ?? "")
        throw new Error("network unavailable")
      },
    })

    const notify = {
      missingSelection() {},
      unqueueable() {},
      failed: () => (attempts.length === 2 ? first.resolve() : second.resolve()),
    }

    const history: string[] = []
    const submission = submitInput(active(state, target), notify, "normal", () => [], history)

    await submission.submit(new Event("submit"))
    await first.promise
    await submission.submit(new Event("submit"))
    await second.promise

    expect(attempts).toHaveLength(4)
    expect(new Set(attempts).size).toBe(1)
    // A retried admission reuses its submission's selection commit.
    const submitted = ["admit", "switch-agent", "switch-model", "send", "admit", "send"]
    expect(calls).toEqual([...submitted, ...submitted])
    expect(statuses).toEqual(["running", "idle", "running", "idle"])
    expect(state.current()).toEqual(prompt)
    // In the order it was sent, so the resend's request matches the first.
    expect(state.context.items()).toMatchObject([
      { type: "file", path: "notes.md", description: "the failing version" },
      note,
    ])
    // The caret returns after the mention text; attachments take no caret positions.
    expect(state.cursor()).toBe(17)
    // The restored prompt is the draft again, so history does not also keep it (and its attachments).
    const entry = "retry @src/app.tsimage"
    expect(history).toEqual([`add:${entry}`, `remove:${entry}`, `add:${entry}`, `remove:${entry}`])
  })

  test("restores first-prompt comments into the promoted Session", async () => {
    const draft = createMemoryComposerState({ prompt: "first prompt" }).capture()
    draft.store[1]("context", "items", [
      {
        key: "file:src/app.ts:1:1:comment",
        type: "file",
        path: "src/app.ts",
        comment: "Keep this comment",
        selection: { startLine: 1, startChar: 0, endLine: 1, endChar: 4 },
      },
    ])
    expect(draft.context.items()).toHaveLength(1)
    const promoted = createMemoryComposerState().capture()
    const failed = Promise.withResolvers<void>()
    const target = session({ calls: [], shell: async () => Promise.reject(new Error("send failed")) })

    const adapter = fresh(draft, async (_selection, submission) => {
      submission.retarget(promoted)

      return { session: target, cleanupReady: Promise.resolve() }
    })

    await submitInput(
      adapter,
      { missingSelection() {}, unqueueable() {}, failed: () => failed.resolve() },
      "shell",
    ).submit(new Event("submit"))
    await failed.promise

    expect(promoted.current()).toMatchObject([{ type: "text", content: "first prompt" }])
    expect(promoted.context.items()).toMatchObject([{ type: "file", path: "src/app.ts", comment: "Keep this comment" }])
    expect(promoted.mode.current()).toBe("shell")
  })

  test("moves a first prompt and its quote sources to the promoted Session, and recovers it with the follow-up typed there", async () => {
    const draft = createMemoryComposerState({ prompt: "first prompt" }).capture()
    draft.context.add({ type: "quote", commentID: "quote-source", text: "quoted passage" })
    const key = draft.context.items()[0]!.key
    const source = [{ partID: "part-source", revealID: "message-source", start: 4, end: 18, text: "quoted passage" }]
    draft.quoteSource.add(key, source)
    // The Session's composer already holds a follow-up typed while it prepared.
    const promoted = createMemoryComposerState({ prompt: "follow-up" }).capture()
    const moved: (typeof promoted.quoteSource.state.sources)[string][] = []
    const release = Promise.withResolvers<void>()
    const failed = Promise.withResolvers<void>()

    const target = session({
      calls: [],
      prompt: async () => {
        await release.promise
        throw new Error("network unavailable")
      },
    })

    await submitInput(
      fresh(draft, async (_selection, submission) => {
        submission.retarget(promoted, { preserveDraft: true })
        moved.push(promoted.quoteSource.state.sources[key])

        return { session: target, cleanupReady: Promise.resolve() }
      }),
      { missingSelection() {}, unqueueable() {}, failed: () => failed.resolve() },
    ).submit(new Event("submit"))

    expect(moved).toEqual([source])
    expect(text(draft)).toBe("")
    expect(text(promoted)).toBe("follow-up")
    release.resolve()
    await failed.promise

    expect(text(promoted)).toBe("first prompt\n\nfollow-up")
    expect(promoted.context.items()).toMatchObject([{ key, type: "quote", text: "quoted passage" }])
    expect(promoted.quoteSource.state.sources[key]).toEqual(source)
    // A recovered follow-up changes the payload, so it is not a retry of the failed admission.
    expect(promoted.retry.current()).toBeUndefined()
  })

  test("does not restore a failed prompt over one typed after the composer cleared", async () => {
    const state = createMemoryComposerState({ prompt: "submitted" }).capture()
    const release = Promise.withResolvers<void>()
    const failed = Promise.withResolvers<void>()
    const history: string[] = []

    const target = session({
      calls: [],
      prompt: async () => {
        await release.promise
        throw new Error("network unavailable")
      },
    })

    await submitInput(
      active(state, target),
      { missingSelection() {}, unqueueable() {}, failed: () => failed.resolve() },
      "normal",
      () => [],
      history,
    ).submit(new Event("submit"))
    state.set([{ type: "text", content: "new draft", start: 0, end: 9 }])
    release.resolve()
    await failed.promise

    expect(text(state)).toBe("new draft")
    expect(history).toEqual(["add:submitted"])
  })

  test("does not restore a prompt already acknowledged by the durable inbox", async () => {
    const state = createMemoryComposerState({ prompt: "admitted prompt" }).capture()
    const checked = Promise.withResolvers<void>()
    const attempts: string[] = []

    const target = session({
      calls: [],
      admitted: () => {
        checked.resolve()

        return true
      },
      prompt: async (value) => {
        attempts.push(value.id ?? "")
        throw new Error("response lost")
      },
    })

    await submitInput(active(state, target)).submit(new Event("submit"))
    await checked.promise

    expect(state.current()).toEqual([{ type: "text", content: "", start: 0, end: 0 }])
    expect(attempts).toHaveLength(2)
    expect(new Set(attempts).size).toBe(1)
  })

  describe("steering while foreground work runs", () => {
    // A long shell command blocks the run; moving it resolves only the move, never the admission.
    // `unstarted` moves before the shell's job starts, so the server finds nothing to move and the call still blocks.
    function running(
      input: {
        fail?: boolean
        failOnce?: boolean
        unstarted?: boolean
        blocking?: { partID: string }[]
        prompt?: () => Promise<void>
      } = {},
    ) {
      const calls: string[] = []
      const failures: string[] = []
      const state = createMemoryComposerState({ prompt: "use Beta instead" }).capture()
      const blocking = { parts: input.blocking ?? [{ partID: "prt_shell" }] }

      const claim = createSteerBackground({
        sessionID: () => "session-1",
        blocking: () => blocking.parts,
        move: async () => {
          calls.push("background")

          if (input.fail) throw new Error("server unavailable")

          if (input.failOnce) {
            input.failOnce = false
            throw new Error("server unavailable")
          }

          if (input.unstarted) {
            input.unstarted = false

            return
          }

          blocking.parts = []
        },
      })

      const target = session({ calls, prompt: input.prompt, background: () => claim("session-1") })
      const adapter = { ...active(state, target), working: () => true }
      const notify = { missingSelection() {}, unqueueable() {}, failed: () => void failures.push("failed") }

      const submit = async (delivery: ComposerDelivery = "steer", working = true) => {
        state.set([{ type: "text", content: "use Beta instead", start: 0, end: 16 }])
        await submitInput(
          { ...adapter, working: () => working },
          notify,
          "normal",
          () => [],
          [],
          undefined,
          () => delivery,
        ).submit(new Event("submit"))
        // The send settles after submit returns; let it and the move that follows it finish.
        await new Promise((resolve) => setTimeout(resolve, 0))
      }

      return { calls, failures, submit, blocking }
    }

    test("moves the work to the background once the steer is admitted, and only once", async () => {
      const run = running()

      await run.submit()
      expect(run.calls).toEqual(["admit", "switch-agent", "switch-model", "send", "accept-send", "background"])

      await run.submit()
      expect(run.calls.filter((call) => call === "background")).toHaveLength(1)
    })

    test("a steer moves work that its previous steer's move missed", async () => {
      const run = running({ unstarted: true })

      await run.submit()
      await run.submit()
      expect(run.calls.filter((call) => call === "background")).toHaveLength(2)
    })

    test("a steer sent while the previous one is admitted moves the work when the previous move fails", async () => {
      const admitted = Promise.withResolvers<void>()
      const attempts = { count: 0 }

      const run = running({
        failOnce: true,
        prompt: async () => {
          attempts.count++

          if (attempts.count === 1) await admitted.promise
        },
      })

      await run.submit()
      await run.submit()
      admitted.resolve()
      await new Promise((resolve) => setTimeout(resolve, 0))
      expect(run.calls.filter((call) => call === "background")).toHaveLength(2)
      expect(run.blocking.parts).toEqual([])
    })

    test("moves a shell that starts while the steer is admitted", async () => {
      const run = running({
        blocking: [],
        prompt: async () => {
          run.blocking.parts = [{ partID: "prt_shell" }]
        },
      })

      await run.submit()
      expect(run.calls.filter((call) => call === "background")).toHaveLength(1)
      expect(run.blocking.parts).toEqual([])
    })

    test("leaves the work alone for a queued prompt or an idle session", async () => {
      const run = running()

      await run.submit("queue")
      await run.submit("steer", false)
      expect(run.calls).not.toContain("background")
    })

    test("still sends the steer when the move fails, and a later steer tries again", async () => {
      const run = running({ fail: true })

      await run.submit()
      await run.submit()
      expect(run.failures).toEqual([])
      expect(run.calls.filter((call) => call === "send")).toHaveLength(2)
      expect(run.calls.filter((call) => call === "background")).toHaveLength(2)
    })

    test("a steer that fails to send leaves the work for the next one", async () => {
      const attempts = { count: 0 }

      const run = running({
        prompt: async () => {
          attempts.count++

          // The first submission's admission and its single retry both fail.
          if (attempts.count <= 2) throw new Error("network unavailable")
        },
      })

      await run.submit()
      expect(run.failures).toEqual(["failed"])
      expect(run.calls).not.toContain("background")

      await run.submit()
      expect(run.calls.filter((call) => call === "background")).toHaveLength(1)
    })
  })

  test("hands off image-only first prompts and admits them before cleanup is ready", async () => {
    const draft = createMemoryComposerState().capture()

    const prompt: Prompt = [
      { type: "text", content: "", start: 0, end: 0 },
      {
        type: "image",
        id: "attachment",
        filename: "image.png",
        mime: "image/png",
        blob: { id: "attachment", url: "data:image/png;base64,YQ==" },
      },
    ]

    draft.set(prompt)
    const handedOff = Promise.withResolvers<SessionMessageHandoff>()
    const admitted = Promise.withResolvers<void>()
    const cleanup = Promise.withResolvers<void>()

    const target = session({
      calls: [],
      handoff: { set: handedOff.resolve, hold() {}, settle() {}, clear() {} },
      prompt: async () => admitted.resolve(),
    })

    const submitted = submitInput(
      fresh(draft, async () => ({ session: target, cleanupReady: cleanup.promise })),
    ).submit(new Event("submit"))

    await admitted.promise
    expect(draft.current()).toEqual(prompt)
    cleanup.resolve()
    await submitted
    expect(draft.current()).toEqual([{ type: "text", content: "", start: 0, end: 0 }])

    expect((await handedOff.promise).message).toMatchObject({
      type: "user",
      text: "",
      files: [
        {
          data: "",
          mime: "image/png",
          source: { type: "uri", uri: "data:image/png;base64,YQ==" },
          name: "image.png",
        },
      ],
    })
  })

  test.each([
    { case: "is admitted", fails: false, admitted: false, result: "settle" },
    { case: "loses its response after admission", fails: true, admitted: true, result: "settle" },
    { case: "fails", fails: true, admitted: false, result: "clear" },
  ])("a steer's handoff waits for its echo or ends when its send $case", async (row) => {
    const state = createMemoryComposerState({ prompt: "steer" }).capture()
    const handoff: string[] = []
    const ended = Promise.withResolvers<void>()

    const target = session({
      calls: [],
      admitted: () => row.admitted,
      handoff: {
        set: (value) => handoff.push(`set:${value.message.id}`),
        hold: (value) => handoff.push(`hold:${value.message.id}`),
        settle: (id) => {
          handoff.push(`settle:${id}`)
          ended.resolve()
        },
        clear: (id) => {
          handoff.push(`clear:${id}`)
          ended.resolve()
        },
      },
      prompt: async () => {
        if (row.fails) throw new Error("response lost")
      },
    })

    await submitInput(active(state, target)).submit(new Event("submit"))
    await ended.promise

    expect(handoff).toHaveLength(2)
    expect(handoff[1]).toBe(handoff[0]!.replace("set:", `${row.result}:`))
  })

  test("forwards structured mentions to custom commands", async () => {
    const state = createMemoryComposerState().capture()
    state.set([
      { type: "text", content: "/review ", start: 0, end: 8 },
      { type: "file", path: "src/app.ts", content: "@src/app.ts", start: 8, end: 19 },
      { type: "text", content: " ", start: 19, end: 20 },
      { type: "agent", name: "review", content: "@review", start: 20, end: 27 },
      { type: "text", content: " ", start: 27, end: 28 },
      {
        type: "skill",
        id: Skill.ID.make("effect"),
        name: Skill.Name.make("Effect"),
        content: "@effect",
        start: 28,
        end: 35,
      },
    ])
    const sent = Promise.withResolvers<Parameters<ComposerSession["api"]["command"]>[0]>()
    const target = session({ calls: [], command: async (value) => sent.resolve(value) })

    await submitInput(active(state, target), undefined, "normal", () => [{ name: "review" }]).submit(
      new Event("submit"),
    )
    const request = await sent.promise

    expect(request.files).toMatchObject([{ name: "app.ts", mention: { text: "@src/app.ts" } }])
    expect(request.agents).toMatchObject([{ name: "review", mention: { text: "@review" } }])
    expect(request.skills).toMatchObject([{ id: "effect", name: "Effect", mention: { text: "@effect" } }])
    expect(request.delivery).toBe("steer")
  })

  test("captures commands before creating a session in a new worktree", async () => {
    const state = createMemoryComposerState({ prompt: "/review https://github.com/example/repo/pull/1" }).capture()
    const catalog = [{ name: "review" }]
    const sent = Promise.withResolvers<"prompt" | "command">()
    const requests: Parameters<ComposerSession["api"]["command"]>[0][] = []

    const target = session({
      calls: [],
      prompt: async () => sent.resolve("prompt"),
      command: async (value) => {
        requests.push(value)
        sent.resolve("command")
      },
    })

    target.directory = "C:/new-worktree"
    target.data.location.command.list = () => undefined

    const adapter = fresh(state, async () => {
      // The destination catalog has not loaded, and the source composer is leaving.
      catalog.splice(0)

      return { session: target, cleanupReady: Promise.resolve() }
    })

    await submitInput(adapter, undefined, "normal", () => catalog).submit(new Event("submit"))

    expect(await sent.promise).toBe("command")
    expect(requests).toEqual([
      {
        sessionID: target.id,
        name: "review",
        text: "https://github.com/example/repo/pull/1",
        files: [],
        agents: [],
        skills: [],
        delivery: "steer",
      },
    ])
  })

  test("does not run an empty shell command from hidden attachments", async () => {
    const state = createMemoryComposerState().capture()
    state.set([
      { type: "text", content: "", start: 0, end: 0 },
      {
        type: "image",
        id: "attachment",
        filename: "notes.txt",
        mime: "text/plain",
        blob: { id: "attachment", url: "data:text/plain;base64,bm90ZXM=" },
      },
    ])
    const calls: string[] = []

    await submitInput(active(state, session({ calls })), undefined, "shell").submit(new Event("submit"))

    expect(calls).toEqual([])
    expect(state.current().some((part) => part.type === "image")).toBe(true)
  })
})
