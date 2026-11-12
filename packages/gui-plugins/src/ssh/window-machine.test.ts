import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import { SshItem, SshState } from "./contract"
import {
  createSshWindowState,
  selectSshCanOffer,
  selectSshError,
  selectSshPromptTarget,
  selectSshResolvable,
  transitionSshWindow,
  type SshWindowEffect,
  type SshWindowEvent,
  type SshWindowState,
} from "./window-machine"

const config = { id: "box", target: "ssh box", name: "Box" }

const prompt = { id: "password", text: "box's password:", confirm: false }

// Main's state reaches the window through the Ipc, which decodes it.
function server(fields: Partial<typeof SshItem.Encoded>): SshItem {
  const state = Schema.decodeUnknownSync(SshState)({
    revision: 1,
    servers: [{ config, saved: true, detail: "", ...fields }],
  })

  const item = state.servers[0]

  if (!item) throw new Error("expected a server")

  return item
}

function replay(state: SshWindowState, events: readonly SshWindowEvent[]) {
  return events.reduce<{ state: SshWindowState; effects: SshWindowEffect[] }>(
    (result, event) => {
      const next = transitionSshWindow(result.state, event)

      return { state: next.state, effects: [...result.effects, ...next.effects] }
    },
    { state, effects: [] },
  )
}

function connect(
  onConnected?: (ready: boolean) => void,
  fields?: { readonly item?: SshItem; readonly dialog?: boolean },
): SshWindowEvent {
  return {
    type: "connect.requested",
    config,
    ipcActive: true,
    item: fields?.item ?? server({ stage: "authentication" }),
    dialog: fields?.dialog,
    onConnected,
  }
}

describe("ssh window attempt", () => {
  test("cancelling the prompt tells the sign-in that waits on it", () => {
    const signIn = (_ready: boolean) => {}

    const result = replay(createSshWindowState(), [
      connect(signIn),
      { type: "start.confirmed", id: config.id, attempt: 1, item: server({ stage: "authentication", prompt }) },
      { type: "cancel.requested", id: config.id, saved: true },
    ])

    expect(result.effects).toEqual([
      { type: "rpc.start", id: config.id, attempt: 1, config, replace: false },
      { type: "waiters.notify", waiters: [signIn], ready: false },
      { type: "rpc.cancel", id: config.id, forget: false },
    ])
    expect(result.state.attempts.size).toBe(0)
  })

  test("a second request joins the attempt in progress and both learn its outcome", () => {
    const first = (_ready: boolean) => {}

    const second = (_ready: boolean) => {}

    const joined = replay(createSshWindowState(), [
      connect(first),
      connect(second),
      { type: "start.confirmed", id: config.id, attempt: 1, item: server({ stage: "connecting" }) },
    ])

    expect(joined.effects.filter((effect) => effect.type === "rpc.start")).toHaveLength(1)

    const settled = transitionSshWindow(joined.state, {
      type: "items.synced",
      ipcActive: true,
      items: [server({ stage: "ready", http: { url: "http://127.0.0.1:1", password: "p" } })],
    })

    expect(settled.effects).toEqual([{ type: "waiters.notify", waiters: [first, second], ready: true }])
  })

  test("a request while another window signs in is told at once and leaves this window alone", () => {
    const waiter = (_ready: boolean) => {}

    const state = createSshWindowState()

    const result = transitionSshWindow(
      state,
      connect(waiter, { item: server({ stage: "authentication", authenticatingElsewhere: true }) }),
    )

    expect(result.state).toBe(state)
    expect(result.effects).toEqual([{ type: "waiters.notify", waiters: [waiter], ready: false }])
  })

  test("a prompt dialog that fails to load ends the attempt instead of wedging the server", () => {
    const waiter = (_ready: boolean) => {}

    const prompted = replay(createSshWindowState(), [
      connect(waiter),
      { type: "start.confirmed", id: config.id, attempt: 1, item: server({ stage: "authentication", prompt }) },
    ]).state

    const items = [server({ stage: "authentication", prompt })]
    expect(selectSshPromptTarget(prompted, items)).toEqual({ item: items[0], attempt: 1 })

    const loading = transitionSshWindow(prompted, { type: "dialog.loading", id: config.id, attempt: 1 }).state
    expect(selectSshPromptTarget(loading, items)).toBeUndefined()

    const failed = transitionSshWindow(loading, { type: "dialog.failed", id: config.id, attempt: 1, saved: true })
    expect(failed.effects).toEqual([
      { type: "waiters.notify", waiters: [waiter], ready: false },
      { type: "toast.error" },
      { type: "rpc.cancel", id: config.id, forget: false },
    ])
    expect(selectSshError(failed.state, config.id)).toBe(true)

    const again = transitionSshWindow(failed.state, connect())
    expect(again.effects).toEqual([{ type: "rpc.start", id: config.id, attempt: 2, config, replace: false }])
  })

  test("a cancelled attempt's late call results do not settle the next attempt", () => {
    const waiter = (_ready: boolean) => {}

    const next = replay(createSshWindowState(), [
      connect(),
      { type: "cancel.requested", id: config.id, saved: true },
      connect(waiter),
    ]).state

    // Main admitted the first attempt before the cancel, then restored the server.
    const late: SshWindowEvent[] = [
      { type: "start.confirmed", id: config.id, attempt: 1, item: server({ stage: "disconnected" }) },
      { type: "start.failed", id: config.id, attempt: 1 },
    ]

    late.forEach((event) => expect(transitionSshWindow(next, event).state).toBe(next))
  })

  test("an answer that fails can be sent again", () => {
    const item = server({ stage: "authentication", prompt })

    const result = replay(createSshWindowState(), [
      connect(undefined, { dialog: true }),
      { type: "start.confirmed", id: config.id, attempt: 1, item },
      { type: "respond.requested", id: config.id, prompt: prompt.id, value: "a", ipcActive: true, item },
      { type: "respond.failed", id: config.id, attempt: 2 },
      { type: "respond.requested", id: config.id, prompt: prompt.id, value: "b", ipcActive: true, item },
    ])

    expect(result.effects.filter((effect) => effect.type === "rpc.respond")).toEqual([
      { type: "rpc.respond", id: config.id, attempt: 2, prompt: prompt.id, value: "a" },
      { type: "rpc.respond", id: config.id, attempt: 3, prompt: prompt.id, value: "b" },
    ])
    // The dialog shows the failure inline instead of a toast.
    expect(result.effects).not.toContainEqual({ type: "toast.error" })
  })

  test("a server that leaves main's state ends its attempt", () => {
    const waiter = (_ready: boolean) => {}

    const waiting = replay(createSshWindowState(), [
      connect(waiter),
      { type: "start.confirmed", id: config.id, attempt: 1, item: server({ stage: "connecting" }) },
    ]).state

    expect(transitionSshWindow(waiting, { type: "items.synced", ipcActive: false, items: [] }).effects).toEqual([
      { type: "waiters.notify", waiters: [waiter], ready: false },
    ])
  })

  test("each saved server restores once per window, and only while disconnected", () => {
    const first = transitionSshWindow(createSshWindowState(), {
      type: "items.synced",
      ipcActive: true,
      items: [server({ stage: "disconnected" }), { ...server({ stage: "ready" }), config: { ...config, id: "up" } }],
    })

    expect(first.effects).toEqual([{ type: "rpc.restore", config }])

    const again = transitionSshWindow(first.state, {
      type: "items.synced",
      ipcActive: true,
      items: [server({ stage: "disconnected" })],
    })

    expect(again.state).toBe(first.state)
    expect(again.effects).toEqual([])
  })

  test("disposing tells every waiter and later requests at once", () => {
    const waiter = (_ready: boolean) => {}

    const later = (_ready: boolean) => {}

    const disposed = replay(createSshWindowState(), [connect(waiter), { type: "disposed" }])

    expect(disposed.effects.slice(1)).toEqual([
      { type: "task.abort", id: config.id },
      { type: "waiters.notify", waiters: [waiter], ready: false },
    ])
    expect(transitionSshWindow(disposed.state, connect(later)).effects).toEqual([
      { type: "waiters.notify", waiters: [later], ready: false },
    ])
  })
})

describe("ssh cover offer", () => {
  const visit = "/new-session?draftId=1"

  const other = { id: "box-b", target: "ssh box-b", name: "Box B" }

  function offer(
    item: SshItem,
    fields?: { readonly path?: string; readonly dialogActive?: boolean; readonly ipcActive?: boolean },
  ): SshWindowEvent {
    return {
      type: "cover.offered",
      id: item.config.id,
      path: fields?.path ?? visit,
      dialogActive: fields?.dialogActive ?? false,
      ipcActive: fields?.ipcActive ?? true,
      item,
    }
  }

  test("a second server that needs a sign-in on the same visit still offers it", () => {
    const first = server({ stage: "authentication" })
    const second = { ...server({ stage: "authentication" }), config: other }

    const result = replay(createSshWindowState(), [{ type: "visit.changed", path: visit }, offer(first), offer(second)])

    expect(result.effects).toEqual([
      { type: "rpc.start", id: config.id, attempt: 1, config, replace: false },
      { type: "rpc.start", id: other.id, attempt: 2, config: other, replace: false },
    ])
  })

  test("each server offers once per visit, and again on a new visit", () => {
    const item = server({ stage: "authentication" })

    const offered = replay(createSshWindowState(), [
      { type: "visit.changed", path: visit },
      offer(item),
      { type: "cancel.requested", id: config.id, saved: true },
    ]).state

    expect(selectSshCanOffer(offered, config.id, visit, false, true, item)).toBe(false)
    expect(transitionSshWindow(offered, offer(item)).state).toBe(offered)

    const back = replay(offered, [
      { type: "visit.changed", path: "/s/other" },
      { type: "visit.changed", path: visit },
      offer(item),
    ])

    expect(back.effects).toEqual([{ type: "rpc.start", id: config.id, attempt: 2, config, replace: false }])
  })

  test("an offer that cannot start is not spent", () => {
    const item = server({ stage: "authentication" })
    const state = transitionSshWindow(createSshWindowState(), { type: "visit.changed", path: visit }).state

    const blocked = [
      offer(item, { ipcActive: false }),
      offer(item, { dialogActive: true }),
      offer(server({ stage: "authentication", authenticatingElsewhere: true })),
      offer(server({ stage: "connecting" })),
    ]

    blocked.forEach((event) => {
      const result = transitionSshWindow(state, event)

      expect(result.state).toBe(state)
      expect(result.effects).toEqual([])
    })

    // Main came back on the same visit: the offer starts the attempt now, without the toast an inactive main gave.
    expect(transitionSshWindow(state, offer(item)).effects).toEqual([
      { type: "rpc.start", id: config.id, attempt: 1, config, replace: false },
    ])
  })

  test("an offer joins the attempt that already shows the prompt and is spent with it", () => {
    const item = server({ stage: "authentication", prompt })

    const joined = replay(createSshWindowState(), [
      { type: "visit.changed", path: visit },
      connect(),
      { type: "start.confirmed", id: config.id, attempt: 1, item },
      offer(item),
    ])

    expect(joined.effects.filter((effect) => effect.type === "rpc.start")).toHaveLength(1)

    // Cancelling that prompt does not reopen it on this visit.
    const cancelled = transitionSshWindow(joined.state, { type: "cancel.requested", id: config.id, saved: true }).state
    expect(selectSshCanOffer(cancelled, config.id, visit, false, true, server({ stage: "authentication" }))).toBe(false)
  })

  test("a disposed window offers nothing", () => {
    const disposed = transitionSshWindow(createSshWindowState(), { type: "disposed" }).state

    expect(transitionSshWindow(disposed, offer(server({ stage: "authentication" }))).state).toBe(disposed)
    expect(transitionSshWindow(disposed, { type: "visit.changed", path: visit }).state).toBe(disposed)
  })
})

describe("ssh resolve", () => {
  test("asks main only while it can answer with an endpoint", () => {
    const cases: [string, boolean, SshItem | undefined, boolean][] = [
      ["main gone", false, server({ stage: "ready", http: { url: "u", password: "p" } }), false],
      ["unknown server", true, undefined, false],
      ["disconnected", true, server({ stage: "disconnected" }), false],
      ["signing in here", true, server({ stage: "authentication" }), false],
      ["incompatible", true, server({ stage: "incompatible", error: "version" }), false],
      ["failed for good", true, server({ stage: "failed", error: "connection" }), false],
      ["ready", true, server({ stage: "ready", http: { url: "u", password: "p" } }), true],
      ["connecting", true, server({ stage: "connecting" }), true],
      ["signing in elsewhere", true, server({ stage: "authentication", authenticatingElsewhere: true }), true],
      ["reconnecting", true, server({ stage: "failed", error: "connection", retrying: true }), true],
    ]

    cases.forEach(([name, ipcActive, item, expected]) =>
      expect(selectSshResolvable(ipcActive, item), name).toBe(expected),
    )
  })
})
