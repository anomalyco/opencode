import { expect, test } from "bun:test"
import { ServerKey } from "./persistence"
import type { ServerConnection } from "./registry"
import {
  createServerControllersState,
  selectServerCtx,
  serverCredentials,
  transitionServerControllers,
  type ServerControllersEvent,
  type ServerControllersState,
} from "./machine"

type Ctx = { readonly name: string }

const url = "http://remote.test"
const key = ServerKey.make(url)
const ssh = ServerKey.make("ssh:box")

const http = (password: string): ServerConnection.Http => ({ type: "http", http: { url, password } })

const plugin = (state: ServerConnection.Plugin["state"], password: string): ServerConnection.Plugin => ({
  type: "plugin",
  key: ssh,
  plugin: "ssh",
  state,
  connecting: false,
  authenticationRequired: false,
  managed: true,
  http: { url, password },
})

const keyOf = (conn: ServerConnection.Any) => (conn.type === "plugin" ? ssh : key)

const synced = (...conns: ServerConnection.Any[]): ServerControllersEvent<Ctx> => ({
  type: "servers.synced",
  entries: conns.map((conn) => ({ key: keyOf(conn), conn, credentials: serverCredentials(conn) })),
})

const reported = (
  conn: ServerConnection.Any,
  health: { healthy: boolean; unauthorized: boolean },
): ServerControllersEvent<Ctx> => ({
  type: "health.reported",
  key: keyOf(conn),
  auth: `${conn.http.url}\n${conn.http.password ?? ""}`,
  ...health,
})

const rejected = { healthy: false, unauthorized: true }

/** Plays the driver: every `create` effect reports a controller named `ctx<attempt>`, and the log keeps the order. */
function run(state: ServerControllersState<Ctx>, event: ServerControllersEvent<Ctx>) {
  const log: string[] = []

  const step = (
    current: ServerControllersState<Ctx>,
    next: ServerControllersEvent<Ctx>,
  ): ServerControllersState<Ctx> => {
    const result = transitionServerControllers(current, next)

    return result.effects.reduce((state, effect) => {
      if (effect.type === "dispose") {
        effect.dispose()

        return state
      }

      const name = `ctx${effect.attempt}`
      log.push(`create ${name}`)

      return step(state, {
        type: "controller.created",
        key: effect.key,
        attempt: effect.attempt,
        ctx: { name },
        dispose: () => log.push(`dispose ${name}`),
      })
    }, result.state)
  }

  return { state: step(state, event), log }
}

function live(conn: ServerConnection.Any) {
  return run(createServerControllersState<Ctx>(), synced(conn)).state
}

test("a listed server starts one controller and reads it once it is live", () => {
  const listed = transitionServerControllers(createServerControllersState<Ctx>(), synced(http("pw1")))

  expect(listed.state.get(key)?.type).toBe("starting")
  expect(selectServerCtx(listed.state, key)).toBeUndefined()
  expect(listed.effects).toEqual([{ type: "create", key, attempt: 1, conn: http("pw1") }])

  const ctx = { name: "ctx1" }
  const created = transitionServerControllers(listed.state, {
    type: "controller.created",
    key,
    attempt: 1,
    ctx,
    dispose: () => {},
  })

  expect(selectServerCtx(created.state, key)).toBe(ctx)
  expect(created.effects).toEqual([])
})

test("a server that rejects its credentials has no controller until it gets new ones", () => {
  const start = live(http("pw1"))
  expect(selectServerCtx(start, key)?.name).toBe("ctx1")

  // The health check answers 401: the controller goes away and nothing reads it again.
  const unauthorized = run(start, reported(http("pw1"), rejected))
  expect(unauthorized.state.get(key)?.type).toBe("unauthorized")
  expect(unauthorized.log).toEqual(["dispose ctx1"])
  expect(selectServerCtx(unauthorized.state, key)).toBeUndefined()

  // The server list syncs again with the rejected credentials: no controller retries them.
  const resynced = transitionServerControllers(unauthorized.state, synced(http("pw1")))
  expect(resynced.state).toBe(unauthorized.state)
  expect(resynced.effects).toEqual([])

  // The user signs in again: a new controller starts with the new password.
  const signedIn = run(resynced.state, synced(http("pw2")))
  expect(signedIn.log).toEqual(["create ctx2"])
  expect(selectServerCtx(signedIn.state, key)?.name).toBe("ctx2")
})

test("a rejection of credentials the server has since replaced changes nothing", () => {
  const rotated = run(live(http("pw1")), synced(http("pw2"))).state
  const late = transitionServerControllers(rotated, reported(http("pw1"), rejected))

  expect(late.state).toBe(rotated)
  expect(late.effects).toEqual([])
  expect(selectServerCtx(late.state, key)?.name).toBe("ctx2")
})

test("new HTTP credentials dispose the old controller before the new one starts", () => {
  expect(run(live(http("pw1")), synced(http("pw2"))).log).toEqual(["dispose ctx1", "create ctx2"])
})

test("a plugin server keeps its controller while its endpoint moves", () => {
  const stopped = run(live(plugin("ready", "ssh-1")), synced(plugin("stopped", "ssh-1")))
  const moved = run(stopped.state, synced(plugin("ready", "ssh-2")))

  expect([...stopped.log, ...moved.log]).toEqual([])
  expect(selectServerCtx(moved.state, ssh)?.name).toBe("ctx1")
})

test("a rejected plugin server waits for a new sign-in instead of reconnecting with nothing", () => {
  const unauthorized = run(live(plugin("ready", "ssh-1")), reported(plugin("ready", "ssh-1"), rejected))
  expect(unauthorized.log).toEqual(["dispose ctx1"])

  const dropped = run(unauthorized.state, synced(plugin("stopped", "ssh-1")))
  expect(dropped.log).toEqual([])
  expect(selectServerCtx(dropped.state, ssh)).toBeUndefined()

  const signedIn = run(dropped.state, synced(plugin("ready", "ssh-2")))
  expect(signedIn.log).toEqual(["create ctx2"])
  expect(selectServerCtx(signedIn.state, ssh)?.name).toBe("ctx2")
})

test("a server that accepts the rejected credentials again gets a controller; a network error does not", () => {
  const unauthorized = run(live(http("pw1")), reported(http("pw1"), rejected)).state

  const offline = transitionServerControllers(
    unauthorized,
    reported(http("pw1"), { healthy: false, unauthorized: false }),
  )
  expect(offline.state).toBe(unauthorized)
  expect(offline.effects).toEqual([])

  const recovered = run(unauthorized, reported(http("pw1"), { healthy: true, unauthorized: false }))
  expect(recovered.log).toEqual(["create ctx2"])
  expect(selectServerCtx(recovered.state, key)?.name).toBe("ctx2")
})

test.each([
  { name: "absent", state: () => createServerControllersState<Ctx>(), attempt: 1 },
  {
    name: "starting a newer attempt",
    state: () => transitionServerControllers(createServerControllersState<Ctx>(), synced(http("pw1"))).state,
    attempt: 0,
  },
  { name: "live", state: () => live(http("pw1")), attempt: 1 },
  { name: "unauthorized", state: () => run(live(http("pw1")), reported(http("pw1"), rejected)).state, attempt: 1 },
])("a superseded controller reported while $name is disposed and never read", (input) => {
  const state = input.state()
  const stale = { name: "stale" }
  const dispose = () => {}

  const result = transitionServerControllers(state, {
    type: "controller.created",
    key,
    attempt: input.attempt,
    ctx: stale,
    dispose,
  })

  expect(result.state).toBe(state)
  expect(result.effects).toEqual([{ type: "dispose", dispose }])
  expect(selectServerCtx(result.state, key)).not.toBe(stale)
})

test("unlisting or unmounting disposes live controllers, and a later listing starts a new attempt", () => {
  const unlisted = run(live(http("pw1")), synced())
  expect(unlisted.log).toEqual(["dispose ctx1"])
  expect(unlisted.state.get(key)).toEqual({ type: "absent", attempt: 1 })

  const relisted = run(unlisted.state, synced(http("pw1")))
  expect(relisted.log).toEqual(["create ctx2"])

  const unauthorized = run(relisted.state, reported(http("pw1"), rejected)).state
  const unmounted = run(unauthorized, { type: "disposed" })
  expect(unmounted.log).toEqual([])
  expect(unmounted.state.get(key)).toEqual({ type: "absent", attempt: 2 })

  const late = transitionServerControllers(unmounted.state, reported(http("pw1"), rejected))
  expect(late.state).toBe(unmounted.state)
})
