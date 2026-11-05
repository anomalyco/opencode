import { describe, expect, test } from "bun:test"
import { Scope } from "@opencode/plugin/gui/host"
import {
  createLifecycleState,
  selectHasPluginScope,
  selectPluginFailure,
  transitionLifecycle,
  type LifecycleCommand,
  type LifecycleEvent,
  type LifecycleState,
} from "./lifecycle-machine"

type Fake = { readonly label: string; readonly instance: { readonly scope: Scope } }

const fake = (label: string): Fake => ({
  label,
  instance: { scope: Scope.make(label, { timeout: 1_000, log: () => {} }) },
})

/**
 * The machine with what its commands did, in order: replies and `after` callbacks run, the other commands are named.
 * Results come back only through the events the test sends.
 */
function machine() {
  const current = { state: createLifecycleState<Fake, string>() }
  // The attempt of the latest command of each type.
  const attempts = new Map<LifecycleCommand<Fake, string>["type"], number>()
  const log: string[] = []

  const send = (event: LifecycleEvent<Fake, string>) => {
    const next = transitionLifecycle(current.state, event)
    current.state = next.state
    next.commands.forEach((command) => {
      if ("attempt" in command && command.attempt !== undefined) attempts.set(command.type, command.attempt)

      if (command.type === "resolve") return command.replies.forEach((reply) => reply())

      if (command.type === "run-after") return command.callbacks.forEach((callback) => callback())

      if (command.type === "dispose") return log.push(`dispose ${command.running.label}`)

      if (command.type === "create") return log.push(`create ${command.revision}`)

      if (command.type === "load") return log.push("load")

      if (command.type === "notify-changed" || command.type === "log-failure") return

      log.push(command.type)
    })

    return next
  }

  const reply = (name: string) => () => void log.push(`settled ${name}`)

  /** The attempt of the last command of `type`, as the driver would report it back. */
  const attempt = (type: "load" | "create" | "await-ready" | "run-setup" | "dispose") => {
    const value = attempts.get(type)

    if (value === undefined) throw new Error(`no ${type} command`)

    return value
  }

  /** Activates `id` until an instance of `revision` is active. */
  const start = (id: string, revision: string, running: Fake) => {
    send({ type: "activate.requested", id, reply: reply(`activate ${revision}`) })
    send({ type: "load.started", id, attempt: attempt("load") })
    send({ type: "load.succeeded", id, attempt: attempt("load"), revision })
    created(id, running)
    send({ type: "setup.succeeded", id, attempt: attempt("run-setup") })
  }

  /** The driver's answer to `create`, up to setup running. */
  const created = (id: string, running: Fake) => {
    send({ type: "instance.created", id, attempt: attempt("create"), running })
    send({ type: "instance.ready", id, attempt: attempt("await-ready"), canRun: true })
  }

  return {
    get state(): LifecycleState<Fake, string> {
      return current.state
    },
    log,
    send,
    reply,
    attempt,
    start,
    created,
    status: (id: string) => current.state.plugins[id]?.status,
  }
}

describe("plugin instance lifecycle", () => {
  test("a restart handoff cancels the reload of the instance it keeps, so a late load never replaces it", () => {
    const m = machine()
    const a1 = fake("a1")
    m.start("a", "a1", a1)
    m.send({ type: "reload.requested", id: "a", keep: undefined, reply: m.reply("reload") })
    const reload = m.attempt("load")
    m.send({ type: "load.started", id: "a", attempt: reload })
    m.log.length = 0

    // On dev the stop skipped `a` and left its reload loading; once the handoff failed, it disposed a1.
    m.send({ type: "stop.requested", id: "a", keep: a1.instance.scope, reply: m.reply("stop") })
    expect(m.state.plugins.a).toEqual({ status: "active", running: a1, revision: "a1", error: undefined })
    expect(m.log).toEqual(["settled reload", "settled stop"])

    const settled = m.state
    expect(m.send({ type: "load.succeeded", id: "a", attempt: reload, revision: "a2" })).toEqual({
      state: settled,
      commands: [],
    })
  })

  test.each([
    { phase: "preparing", setup: false },
    { phase: "setting-up", setup: true },
    { phase: "active", setup: true },
  ])("a reload during the handoff leaves the kept $phase instance alone, and a real quit stops it", (row) => {
    const m = machine()
    const a1 = fake("a1")
    m.send({ type: "activate.requested", id: "a", reply: m.reply("activate") })
    m.send({ type: "load.succeeded", id: "a", attempt: m.attempt("load"), revision: "a1" })
    m.send({ type: "instance.created", id: "a", attempt: m.attempt("create"), running: a1 })

    if (row.setup) m.send({ type: "instance.ready", id: "a", attempt: m.attempt("await-ready"), canRun: true })

    if (row.phase === "active") m.send({ type: "setup.succeeded", id: "a", attempt: m.attempt("run-setup") })
    expect(m.status("a")).toBe(row.phase)
    expect(selectHasPluginScope(m.state, a1.instance.scope)).toBe(true)
    const kept = m.state
    m.log.length = 0

    // On dev a reload disposed an instance whose setup had not finished, even the one running the handoff.
    expect(m.send({ type: "reload.requested", id: "a", keep: a1.instance.scope, reply: m.reply("reload") }).state).toBe(
      kept,
    )
    expect(m.log).toEqual(["settled reload"])

    m.send({ type: "stop.requested", id: "a", keep: undefined, reply: m.reply("quit") })
    expect(m.status("a")).toBe("disposing")
    expect(m.log).toEqual(["settled reload", "dispose a1"])
  })

  test("a fallback whose setup fails too leaves nothing for the next failed reload to bring back", () => {
    const m = machine()
    m.start("a", "a1", fake("a1"))
    m.send({ type: "reload.requested", id: "a", keep: undefined, reply: m.reply("reload a2") })
    m.send({ type: "load.succeeded", id: "a", attempt: m.attempt("load"), revision: "a2" })
    m.send({ type: "dispose.settled", id: "a", attempt: m.attempt("dispose"), canRun: true })
    m.created("a", fake("a2"))
    m.send({ type: "setup.failed", id: "a", attempt: m.attempt("run-setup"), error: new Error("a2 failed") })
    m.send({ type: "dispose.settled", id: "a", attempt: m.attempt("dispose"), canRun: true })
    m.created("a", fake("a1 again"))
    m.send({ type: "setup.failed", id: "a", attempt: m.attempt("run-setup"), error: new Error("a1 failed") })
    m.send({ type: "dispose.settled", id: "a", attempt: m.attempt("dispose"), canRun: true })
    expect(m.state.plugins.a).toEqual({ status: "failed", error: "a1 failed" })
    m.log.length = 0

    // On dev the last good revision outlived its failed fallback, and a reload whose load failed started it again.
    m.send({ type: "reload.requested", id: "a", keep: undefined, reply: m.reply("reload a3") })
    m.send({ type: "load.failed", id: "a", attempt: m.attempt("load"), error: new Error("a3 failed") })
    expect(m.state.plugins.a).toEqual({ status: "failed", error: "a3 failed" })
    expect(m.log).toEqual(["load", "settled reload a3"])
  })

  test("a failed reload returns to the last good revision and keeps the failure for Settings", () => {
    const m = machine()
    m.start("a", "a1", fake("a1"))
    m.send({ type: "reload.requested", id: "a", keep: undefined, reply: m.reply("reload") })
    m.send({ type: "load.succeeded", id: "a", attempt: m.attempt("load"), revision: "a2" })
    m.send({ type: "dispose.settled", id: "a", attempt: m.attempt("dispose"), canRun: true })
    m.created("a", fake("a2"))
    m.send({ type: "setup.failed", id: "a", attempt: m.attempt("run-setup"), error: new Error("a2 failed") })
    m.send({ type: "dispose.settled", id: "a", attempt: m.attempt("dispose"), canRun: true })
    m.log.length = 0
    const back = fake("a1 again")
    m.created("a", back)
    m.send({ type: "setup.succeeded", id: "a", attempt: m.attempt("run-setup") })
    expect(m.state.plugins.a).toEqual({ status: "active", running: back, revision: "a1", error: "a2 failed" })
    expect(selectPluginFailure(m.state, "a")).toBe("a2 failed")
    expect(m.log).toEqual(["await-ready", "run-setup", "settled reload"])
  })

  test("results of a step that was superseded change nothing, and an orphaned instance is disposed", () => {
    const m = machine()
    m.send({ type: "activate.requested", id: "a", reply: m.reply("first") })
    const first = m.attempt("load")
    m.send({ type: "deactivate.requested", id: "a", reply: m.reply("removed") })
    m.send({ type: "activate.requested", id: "a", reply: m.reply("reinstalled") })
    m.send({ type: "load.succeeded", id: "a", attempt: m.attempt("load"), revision: "a2" })
    const create = m.attempt("create")
    m.send({ type: "instance.created", id: "a", attempt: create, running: fake("a2") })
    const preparing = m.state
    expect(first).toBeLessThan(create)

    const stale: LifecycleEvent<Fake, string>[] = [
      { type: "load.started", id: "a", attempt: first },
      { type: "load.succeeded", id: "a", attempt: first, revision: "a1" },
      { type: "load.failed", id: "a", attempt: first, error: new Error("late") },
      { type: "load.cancelled", id: "a", attempt: first },
      { type: "instance.ready", id: "a", attempt: first, canRun: true },
      { type: "setup.succeeded", id: "a", attempt: first },
      { type: "setup.failed", id: "a", attempt: first, error: new Error("late") },
      { type: "dispose.settled", id: "a", attempt: first, canRun: true },
    ]
    stale.forEach((event) => expect(m.send(event)).toEqual({ state: preparing, commands: [] }))

    const orphan = fake("a1")
    expect(m.send({ type: "instance.created", id: "a", attempt: first, running: orphan })).toEqual({
      state: preparing,
      commands: [{ type: "dispose", id: "a", running: orphan }],
    })
  })

  test("a deactivate runs its `after` once the instance is gone, before what waited behind it starts", () => {
    const m = machine()
    m.start("a", "a1", fake("a1"))
    m.log.length = 0
    m.send({ type: "deactivate.requested", id: "a", after: () => void m.log.push("after"), reply: m.reply("remove") })
    m.send({ type: "activate.requested", id: "a", reply: m.reply("activate") })
    m.send({ type: "reload.requested", id: "a", keep: undefined, reply: m.reply("reload") })
    expect(m.log).toEqual(["dispose a1"])

    m.send({ type: "dispose.settled", id: "a", attempt: m.attempt("dispose"), canRun: true })
    // The reload superseded the activation queued before it.
    expect(m.log).toEqual(["dispose a1", "after", "settled remove", "settled activate", "load"])
    expect(m.status("a")).toBe("loading")
  })

  test.each([{ cancel: "at start" }, { cancel: "after load" }])("an activation cancelled $cancel settles stopped", (row) => {
    const m = machine()
    m.start("a", "a1", fake("a1"))
    m.send({ type: "stop.requested", id: "a", keep: undefined, reply: m.reply("stop") })
    m.send({ type: "dispose.settled", id: "a", attempt: m.attempt("dispose"), canRun: false })
    m.send({ type: "activate.requested", id: "a", reply: m.reply("activate") })

    if (row.cancel === "after load") m.send({ type: "load.started", id: "a", attempt: m.attempt("load") })
    m.send({ type: "load.cancelled", id: "a", attempt: m.attempt("load") })
    expect(m.state.plugins).toEqual({})
    expect(m.log.at(-1)).toBe("settled activate")
  })
})
