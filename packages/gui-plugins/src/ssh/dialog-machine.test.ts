import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import { SshItem, SshState } from "./contract"
import {
  createSshDialogState,
  transitionSshDialog,
  viewSshDialog,
  type SshDialogEffect,
  type SshDialogEvent,
  type SshDialogSnapshot,
  type SshDialogState,
} from "./dialog-machine"

const config = { id: "box", target: "ssh box", name: "Box" }

const password = { id: "password", text: "box's password:", confirm: false }

const otp = { id: "otp", text: "Verification code:", confirm: false }

const hostKey = { id: "host-key", text: "Trust this host?", confirm: true }

// Main's state reaches the window through the Ipc, which decodes it.
function server(fields: Partial<typeof SshItem.Encoded>): SshItem {
  const item = Schema.decodeUnknownSync(SshState)({
    revision: 1,
    servers: [{ config, saved: true, detail: "", ...fields }],
  }).servers[0]

  if (!item) throw new Error("expected a server")

  return item
}

function snapshot(fields: Partial<SshDialogSnapshot>): SshDialogSnapshot {
  return {
    item: undefined,
    submitting: false,
    error: false,
    answeredPrompt: undefined,
    activeAttempt: false,
    ...fields,
  }
}

function synced(fields: Partial<SshDialogSnapshot>): SshDialogEvent {
  return { type: "synced", snapshot: snapshot(fields) }
}

function replay(state: SshDialogState, events: readonly SshDialogEvent[]) {
  return events.reduce<{ state: SshDialogState; effects: SshDialogEffect[] }>(
    (result, event) => {
      const next = transitionSshDialog(result.state, event)

      return { state: next.state, effects: [...result.effects, ...next.effects] }
    },
    { state, effects: [] },
  )
}

const adding = () => replay(createSshDialogState({ id: config.id }), [{ type: "target.changed", value: config.target }])

describe("ssh dialog", () => {
  test("a prompt main cleared without an answer goes at once", () => {
    const asked = snapshot({ item: server({ stage: "authentication", prompt: password }), activeAttempt: true })

    const cleared = snapshot({ item: server({ stage: "connecting" }), activeAttempt: true })

    const result = replay(adding().state, [
      { type: "submitted", snapshot: snapshot({}) },
      { type: "synced", snapshot: asked },
      { type: "synced", snapshot: cleared },
    ])

    expect(viewSshDialog(result.state, cleared).prompt).toBeUndefined()
  })

  test("the answered prompt stays, waiting, until main asks the next one", () => {
    const answered = snapshot({
      item: server({ stage: "connecting" }),
      activeAttempt: true,
      answeredPrompt: password.id,
    })

    const next = snapshot({ item: server({ stage: "authentication", prompt: otp }), activeAttempt: true })

    const checking = replay(adding().state, [
      { type: "submitted", snapshot: snapshot({}) },
      synced({ item: server({ stage: "authentication", prompt: password }), activeAttempt: true }),
      { type: "response.changed", prompt: password.id, value: "secret" },
      { type: "synced", snapshot: answered },
    ]).state

    expect(viewSshDialog(checking, answered)).toMatchObject({ prompt: password, waiting: true, response: "secret" })

    const asked = transitionSshDialog(checking, { type: "synced", snapshot: next }).state
    expect(viewSshDialog(asked, next)).toMatchObject({ prompt: otp, response: "", waiting: false })
  })

  test("starting again forgets the prompt shown before", () => {
    const failed = snapshot({ item: server({ stage: "failed", error: "connection" }), error: false })

    const result = replay(adding().state, [
      { type: "submitted", snapshot: snapshot({}) },
      synced({ item: server({ stage: "authentication", prompt: password }), activeAttempt: true }),
      { type: "synced", snapshot: failed },
      { type: "submitted", snapshot: failed },
    ])

    const starting = snapshot({ item: server({ stage: "failed", error: "connection" }), submitting: true })
    expect(viewSshDialog(result.state, starting)).toMatchObject({ prompt: undefined, title: "add", showForm: true })
  })

  test("main going away while the dialog starts fails instead of connecting forever", () => {
    const started = transitionSshDialog(adding().state, { type: "submitted", snapshot: snapshot({}) })

    expect(started.effects).toEqual([
      { type: "connect", config: { id: config.id, target: config.target, name: "" }, replace: false },
    ])

    // `start` resolved, then main dropped: the attempt settled without a server and without an error.
    const gone = snapshot({})
    const state = transitionSshDialog(started.state, { type: "synced", snapshot: gone }).state

    expect(viewSshDialog(state, gone)).toMatchObject({
      error: "common.requestFailed",
      showForm: true,
      inputsDisabled: false,
      primary: { action: "submit", disabled: false, label: "form.add" },
    })
    expect(transitionSshDialog(state, { type: "submitted", snapshot: gone }).effects).toHaveLength(1)
  })

  test("the attempt connects while main shows no server yet", () => {
    const state = transitionSshDialog(adding().state, { type: "submitted", snapshot: snapshot({}) }).state

    expect(viewSshDialog(state, snapshot({ activeAttempt: true }))).toMatchObject({
      error: undefined,
      inputsDisabled: true,
      primary: { disabled: true, label: "stage.connecting" },
    })
  })

  test("a confirm prompt is answered with yes, and an incompatible server updates", () => {
    const item = server({ stage: "authentication", prompt: hostKey })
    const asked = snapshot({ item, activeAttempt: true })

    const confirmed = replay(adding().state, [
      { type: "submitted", snapshot: snapshot({}) },
      { type: "synced", snapshot: asked },
      { type: "responded", snapshot: asked },
    ])

    expect(confirmed.effects.at(-1)).toEqual({ type: "respond", prompt: hostKey.id, value: "yes" })
    expect(viewSshDialog(confirmed.state, asked).primary.label).toBe("trust")

    const incompatible = snapshot({ item: server({ stage: "incompatible", error: "version" }) })
    const state = transitionSshDialog(confirmed.state, { type: "synced", snapshot: incompatible }).state

    expect(viewSshDialog(state, incompatible)).toMatchObject({
      showForm: false,
      incompatible: true,
      error: undefined,
      primary: { action: "submit", label: "update" },
    })
    expect(transitionSshDialog(state, { type: "submitted", snapshot: incompatible }).effects).toEqual([
      { type: "connect", config: { id: config.id, target: config.target, name: "" }, replace: true },
    ])
  })

  test("an empty response or one already sent is not sent", () => {
    const asked = snapshot({ item: server({ stage: "authentication", prompt: password }), activeAttempt: true })

    const state = replay(adding().state, [
      { type: "submitted", snapshot: snapshot({}) },
      { type: "synced", snapshot: asked },
    ]).state

    expect(transitionSshDialog(state, { type: "responded", snapshot: asked }).effects).toEqual([])

    const typed = transitionSshDialog(state, { type: "response.changed", prompt: password.id, value: "a" }).state
    const sent = snapshot({ ...asked, answeredPrompt: password.id })

    expect(transitionSshDialog(typed, { type: "responded", snapshot: sent }).effects).toEqual([])
    expect(transitionSshDialog(typed, { type: "responded", snapshot: asked }).effects).toEqual([
      { type: "respond", prompt: password.id, value: "a" },
    ])
  })

  test("a ready server completes once, and closing afterwards cancels nothing", () => {
    const ready = snapshot({ item: server({ stage: "ready", http: { url: "u", password: "p" } }) })

    const result = replay(createSshDialogState({ id: config.id, config }), [
      { type: "submitted", snapshot: snapshot({}) },
      { type: "synced", snapshot: ready },
      { type: "synced", snapshot: ready },
      { type: "disposed" },
    ])

    expect(result.effects.filter((effect) => effect.type !== "connect")).toEqual([{ type: "complete" }])
  })

  test("closing cancels only an attempt the dialog started", () => {
    expect(transitionSshDialog(adding().state, { type: "disposed" }).effects).toEqual([])

    expect(
      replay(adding().state, [{ type: "submitted", snapshot: snapshot({}) }, { type: "disposed" }]).effects.at(-1),
    ).toEqual({ type: "cancel" })

    const prompt = createSshDialogState({ id: config.id, config, promptOnly: true })
    expect(transitionSshDialog(prompt, { type: "disposed" }).effects).toEqual([{ type: "cancel" }])
  })

  test("a dialog that is busy or has no target does not start", () => {
    const empty = createSshDialogState({ id: config.id })

    expect(transitionSshDialog(empty, { type: "submitted", snapshot: snapshot({}) }).state).toBe(empty)

    const state = adding().state
    expect(transitionSshDialog(state, { type: "submitted", snapshot: snapshot({ submitting: true }) }).state).toBe(
      state,
    )
  })
})
