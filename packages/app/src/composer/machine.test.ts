import { describe, expect, test } from "bun:test"
import { SessionMessage } from "@opencode/schema/session-message"
import type { ComposerSession } from "./adapter"
import {
  composerSubmitView,
  createComposerSubmitState,
  transitionComposerSubmit,
  type ComposerSubmitEvent,
  type ComposerSubmitState,
  type ComposerSubmitTransition,
  type QuoteSnapshot,
  type SubmitSnapshot,
} from "./machine"
import { retryFingerprint } from "./retry"
import { createMemoryComposerState, type ImageAttachmentPart, type Prompt } from "./state"

const target = createMemoryComposerState().capture()

const promoted = createMemoryComposerState().capture()

const selection = { agent: "build", model: { providerID: "provider-1", modelID: "model-1" }, variant: "balanced" }

const ready = Promise.resolve()

const done = () => {}

const image: ImageAttachmentPart = {
  type: "image",
  id: "attachment",
  filename: "shot.png",
  mime: "image/png",
  blob: { id: "attachment", url: "" },
}

const session: ComposerSession = {
  id: "session-1",
  directory: "C:/repo",
  handoff: { set() {}, hold() {}, settle() {}, clear() {} },
  api: {
    command: async () => undefined,
    shell: async () => undefined,
    switchAgent: async () => undefined,
    switchModel: async () => undefined,
    revert: { commit: async () => undefined },
  },
  file: { list: async () => ({ data: [] }) },
  data: {
    location: { command: { list: () => [] } },
    session: {
      prompt: async (value) => ({
        id: value.id ?? "msg_admitted",
        sessionID: value.sessionID,
        time: { created: 0 },
        type: "user" as const,
        payload: { text: value.text },
        delivery: value.delivery ?? "steer",
      }),
      setStatus() {},
      acceptSend() {},
    },
  },
  current: () => undefined,
  admitted: () => false,
}

function snapshot(
  input: Partial<SubmitSnapshot> = {},
  prompt: Prompt = [
    { type: "text", content: input.text ?? "ship it", start: 0, end: (input.text ?? "ship it").length },
  ],
): SubmitSnapshot {
  return {
    draft: { initial: target, target, preserveDraft: false, prompt, context: [], sources: [] },
    serialized: JSON.stringify(prompt),
    text: "ship it",
    mode: "normal",
    alternate: false,
    delivery: "steer",
    selection,
    loading: false,
    retry: undefined,
    id: SessionMessage.ID.create(),
    commands: [],
    clientCommand: undefined,
    comments: [],
    session: undefined,
    ...input,
  }
}

function quoteSnapshot(input: Partial<QuoteSnapshot> = {}): QuoteSnapshot {
  return {
    key: "quote:c=selected",
    quote: { key: "quote:c=selected", type: "quote", text: "Selected passage", commentID: "selected" },
    comment: "Compare",
    selection,
    delivery: "steer",
    id: SessionMessage.ID.create(),
    session,
    ...input,
  }
}

function replay(
  events: ComposerSubmitEvent[],
  state: ComposerSubmitState = createComposerSubmitState(),
): ComposerSubmitTransition {
  const event = events[0]

  if (!event) return { state, effects: [] }
  const step = transitionComposerSubmit(state, event)
  const rest = replay(events.slice(1), step.state)

  return { state: rest.state, effects: [...step.effects, ...rest.effects] }
}

const started = (attempt: number): ComposerSubmitEvent => ({
  type: "session.started",
  attempt,
  images: [],
  session,
  ready,
})

const states = {
  held: replay([{ type: "submit", snapshot: snapshot({ selection: undefined, loading: true }), done }]).state,
  shown: replay([{ type: "submit", snapshot: snapshot({ selection: undefined, loading: true, session }), done }]).state,
  running: replay([{ type: "submit", snapshot: snapshot({ clientCommand: () => undefined }), done }]).state,
  preparing: replay([{ type: "submit", snapshot: snapshot(), done }]).state,
  "handing-off": replay([{ type: "submit", snapshot: snapshot(), done }, started(1)]).state,
}

describe("composer submit machine", () => {
  test("pressing Enter and then Send while image attachments resolve starts one send with one message ID", () => {
    const first = snapshot({}, [{ type: "text", content: "ship it", start: 0, end: 7 }, image])

    const result = replay([
      { type: "submit", snapshot: first, done },
      // Enter, then a click on Send, Mod+Enter and a quote, all while the image's URL resolves.
      { type: "submit", snapshot: snapshot(), done },
      { type: "submit", snapshot: snapshot({ alternate: true }), done },
      { type: "quote", snapshot: quoteSnapshot(), done },
      {
        type: "session.started",
        attempt: 1,
        images: [{ ...image, blob: { id: "attachment", url: "blob:shot" } }],
        session,
        ready,
      },
      { type: "handoff.ready", attempt: 1, prompt: undefined },
    ])

    expect(result.state).toEqual({ type: "idle", attempt: 1 })
    expect(result.effects.filter((effect) => effect.type === "session.start")).toMatchObject([
      { attempt: 1, value: { id: first.id, images: [image] } },
    ])
    expect(result.effects.filter((effect) => effect.type === "handoff")).toMatchObject([
      { attempt: 1, sendFirst: true, value: { id: first.id, images: [{ blob: { url: "blob:shot" } }] } },
    ])
    // The three repeats settle as not sent; only the first submit settles as sent, once the composer clears.
    expect(result.effects.flatMap((effect) => (effect.type === "done" ? [effect.sent] : []))).toEqual([
      false,
      false,
      false,
      true,
    ])
  })

  test("reuses a failed prompt's ID only for the same prompt, never for a shell or server command", () => {
    const sent = (input: Partial<SubmitSnapshot>, prompt?: Prompt) =>
      transitionComposerSubmit(createComposerSubmitState(), {
        type: "submit",
        snapshot: snapshot(input, prompt),
        done,
      }).effects.find((effect) => effect.type === "session.start")?.value.id

    const fingerprint = (value: SubmitSnapshot) =>
      retryFingerprint({ ...value, selection, prompt: value.draft.prompt, context: value.draft.context })

    const retry = { id: SessionMessage.ID.create(), fingerprint: fingerprint(snapshot()) }

    expect(sent({ retry })).toBe(retry.id)
    // The ID used to follow the selection alone, so a changed delivery or prompt reused it and the server dropped them.
    expect(sent({ retry, delivery: "queue" })).not.toBe(retry.id)
    expect(sent({ retry, text: "ship it now" })).not.toBe(retry.id)
    expect(sent({ retry, selection: { ...selection, variant: "high" } })).not.toBe(retry.id)

    const review = snapshot({ text: "/review", commands: [{ name: "review" }] })
    const shell = snapshot({ mode: "shell" })

    expect(sent({ ...review, retry: { id: retry.id, fingerprint: fingerprint(review) } })).toBe(review.id)
    expect(sent({ ...shell, retry: { id: retry.id, fingerprint: fingerprint(shell) } })).toBe(shell.id)
  })

  test.each(Object.entries(states))("ignores another submit or quote while %s", (_name, state) => {
    expect(transitionComposerSubmit(state, { type: "submit", snapshot: snapshot(), done })).toEqual({
      state,
      effects: [{ type: "done", done, sent: false }],
    })
    expect(transitionComposerSubmit(state, { type: "quote", snapshot: quoteSnapshot(), done })).toEqual({
      state,
      effects: [{ type: "done", done, sent: false }],
    })
  })

  test("holds a send while the Location loads, until stopped, edited, unmounted or loaded", () => {
    const held = states.held

    expect(held).toMatchObject({ type: "held", attempt: 1, shown: undefined })
    expect(composerSubmitView(held)).toEqual({ held: true, busy: true, canSubmit: false })

    const cancelled: ComposerSubmitTransition = {
      state: { type: "idle", attempt: 1 },
      effects: [{ type: "done", done, sent: false }],
    }

    expect(transitionComposerSubmit(held, { type: "stop" })).toEqual(cancelled)
    expect(transitionComposerSubmit(held, { type: "unmounted" })).toEqual(cancelled)
    expect(transitionComposerSubmit(held, { type: "hold.changed", attempt: 1 })).toEqual(cancelled)
    expect(transitionComposerSubmit(held, { type: "hold.loaded", attempt: 1, selection, commands: [] })).toEqual({
      state: { type: "idle", attempt: 1 },
      effects: [{ type: "submit.retry", alternate: false, done }],
    })

    // Elsewhere, Stop interrupts the session, and unmounting leaves the send to finish in the promoted Session.
    expect(transitionComposerSubmit(states.preparing, { type: "stop" })).toEqual({
      state: states.preparing,
      effects: [{ type: "interrupt" }],
    })
    expect(transitionComposerSubmit(states.preparing, { type: "unmounted" })).toEqual({
      state: states.preparing,
      effects: [],
    })
  })

  test("a prompt held while a Session's Location loads shows in its timeline at once and sends once it loads", () => {
    const held = snapshot({ selection: undefined, loading: true, session })
    const cleared: Prompt = [{ type: "text", content: "", start: 0, end: 0 }]

    // Enter shows the prompt and clears the composer before the agents and models load, with no request in flight.
    const shown = replay([
      { type: "submit", snapshot: held, done },
      { type: "hold.cleared", attempt: 1, cleared },
      // A new draft typed meanwhile is the user's, so it no longer cancels the send.
      { type: "hold.changed", attempt: 1 },
    ])

    expect(shown.effects).toEqual([{ type: "hold.show", attempt: 1, session, snapshot: held }])
    expect(shown.state).toMatchObject({ type: "held", attempt: 1, shown: { session, cleared } })
    expect(composerSubmitView(shown.state)).toEqual({ held: true, busy: true, canSubmit: false })

    const sent = replay(
      [
        { type: "hold.loaded", attempt: 1, selection, commands: [{ name: "review" }] },
        started(1),
        { type: "handoff.ready", attempt: 1, prompt: undefined },
      ],
      shown.state,
    )

    // The send keeps the shown message's ID, records no second history entry, and leaves the new draft alone.
    expect(sent.effects.map((effect) => effect.type)).toEqual(["session.start", "handoff", "composer.clear", "done"])
    expect(sent.effects[0]).toMatchObject({ value: { id: held.id, selection, text: "ship it" } })
    expect(sent.effects[2]).toMatchObject({ type: "composer.clear", cleared, value: { id: held.id } })
    expect(sent.effects[3]).toEqual({ type: "done", done, sent: true })
  })

  test.each([
    { name: "Stop", event: { type: "stop" } },
    { name: "unmounting", event: { type: "unmounted" } },
  ] satisfies { name: string; event: ComposerSubmitEvent }[])(
    "$name cancels a shown hold and returns its prompt to the composer",
    (row) => {
      const held = snapshot({ selection: undefined, loading: true, session })
      const cleared: Prompt = [{ type: "text", content: "", start: 0, end: 0 }]

      const result = replay([
        { type: "submit", snapshot: held, done },
        { type: "hold.cleared", attempt: 1, cleared },
        row.event,
        { type: "hold.loaded", attempt: 1, selection, commands: [] },
      ])

      expect(result.state).toEqual({ type: "idle", attempt: 1 })
      expect(result.effects.slice(1)).toEqual([
        { type: "hold.cancel", session, snapshot: held, cleared },
        { type: "done", done, sent: false },
      ])
    },
  )

  test("a shown hold whose Location loads without a model returns its prompt and asks for one", () => {
    const held = snapshot({ selection: undefined, loading: true, session })

    const result = replay([
      { type: "submit", snapshot: held, done },
      { type: "hold.loaded", attempt: 1, selection: undefined, commands: [] },
    ])

    expect(result.state).toEqual({ type: "idle", attempt: 1 })
    expect(result.effects.slice(1)).toEqual([
      { type: "notify.missing-selection" },
      { type: "hold.cancel", session, snapshot: held, cleared: undefined },
      { type: "done", done, sent: false },
    ])
  })

  test.each([
    { name: "a slash command", input: { text: "/review" } },
    { name: "a shell command", input: { mode: "shell" } },
    { name: "a queued prompt", input: { delivery: "queue" } },
    { name: "a new-session draft", input: { session: undefined } },
  ] satisfies { name: string; input: Partial<SubmitSnapshot> }[])(
    "$name held while the Location loads waits in the composer",
    (row) => {
      const result = replay([
        { type: "submit", snapshot: snapshot({ selection: undefined, loading: true, session, ...row.input }), done },
      ])

      expect(result).toMatchObject({ state: { type: "held", shown: undefined }, effects: [] })
    },
  )

  test.each([
    {
      name: "a late load after Stop",
      events: [{ type: "stop" }, { type: "hold.loaded", attempt: 1, selection, commands: [] }],
      from: "held",
    },
    {
      name: "a late clear or load after a shown hold is stopped",
      events: [
        { type: "stop" },
        { type: "hold.cleared", attempt: 1, cleared: [] },
        { type: "hold.loaded", attempt: 1, selection, commands: [] },
      ],
      from: "shown",
    },
    {
      name: "a start after an aborted one",
      events: [{ type: "submit.aborted", attempt: 1 }, started(1)],
      from: "preparing",
    },
    {
      name: "a retarget, ready or settle for another attempt",
      events: [
        { type: "session.retargeted", attempt: 2, target: promoted, preserveDraft: false },
        { type: "handoff.ready", attempt: 2, prompt: undefined },
        { type: "run.settled", attempt: 1, sent: true },
      ],
      from: "handing-off",
    },
  ] satisfies { name: string; events: ComposerSubmitEvent[]; from: keyof typeof states }[])("ignores $name", (row) => {
    const settled = transitionComposerSubmit(states[row.from], row.events[0]!)
    const late = replay(row.events.slice(1), settled.state)

    expect(late).toEqual({ state: settled.state, effects: [] })
  })
})
