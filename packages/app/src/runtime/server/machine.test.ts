import { expect, test } from "bun:test"
import { ServerKey } from "./persistence"
import type { ServerConnection } from "./registry"
import {
  createServerControllersState,
  selectServerCtx,
  selectServerSignedOut,
  serverCredentials,
  transitionServerControllers,
  type ServerControllersEvent,
  type ServerControllersState,
} from "./machine"

type Ctx = { readonly name: string }

const url = "http://remote.test"

const key = ServerKey.make(url)

// The registry hands out the same connection object until it changes, as the store does.
const connections = new Map<string, ServerConnection.Http>()

const http = (password: string) => {
  const conn: ServerConnection.Http = connections.get(password) ?? { type: "http", http: { url, password } }
  connections.set(password, conn)

  return conn
}

const synced = (conn: ServerConnection.Http): ServerControllersEvent<Ctx> => ({
  type: "servers.synced",
  entries: [{ key, conn, credentials: serverCredentials(conn) }],
})

const rejected = (password: string): ServerControllersEvent<Ctx> => ({
  type: "health.reported",
  key,
  auth: `${url}\n${password}`,
  healthy: false,
  unauthorized: true,
})

// Controllers dispose long after the run that created them, so every run appends to one log.
const log: string[] = []

/** Plays the driver: every `create` effect reports a controller named `ctx<attempt>`; returns what this run logged. */
function run(state: ServerControllersState<Ctx>, event: ServerControllersEvent<Ctx>) {
  const from = log.length

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

  const next = step(state, event)

  return { state: next, log: log.slice(from) }
}

function live(password: string) {
  return run(createServerControllersState<Ctx>(), synced(http(password))).state
}

test("a server that rejects its credentials has no controller until it gets new ones", () => {
  const start = live("pw1")
  expect(selectServerCtx(start, key)?.name).toBe("ctx1")
  expect(selectServerSignedOut(start, key)).toBe(false)

  // The health check answers 401: the controller goes away, nothing reads it again, and the routes ask to sign in.
  const unauthorized = run(start, rejected("pw1"))
  expect(unauthorized.log).toEqual(["dispose ctx1"])
  expect(selectServerCtx(unauthorized.state, key)).toBeUndefined()
  expect(selectServerSignedOut(unauthorized.state, key)).toBe(true)

  // The server list syncs again with the rejected credentials: no controller retries them.
  const resynced = transitionServerControllers(unauthorized.state, synced(http("pw1")))
  expect(resynced.state).toBe(unauthorized.state)
  expect(resynced.effects).toEqual([])

  // The user signs in again: a new controller starts with the new password.
  const signedIn = run(resynced.state, synced(http("pw2")))
  expect(signedIn.log).toEqual(["create ctx2"])
  expect(selectServerCtx(signedIn.state, key)?.name).toBe("ctx2")
  expect(selectServerSignedOut(signedIn.state, key)).toBe(false)
})

test("a rejection of credentials the server has since replaced changes nothing", () => {
  const rotated = run(live("pw1"), synced(http("pw2"))).state
  const late = transitionServerControllers(rotated, rejected("pw1"))

  expect(late.state).toBe(rotated)
  expect(late.effects).toEqual([])
  expect(selectServerCtx(late.state, key)?.name).toBe("ctx2")
})

test("new HTTP credentials dispose the old controller before the new one starts", () => {
  expect(run(live("pw1"), synced(http("pw2"))).log).toEqual(["dispose ctx1", "create ctx2"])
})

test.each([
  { name: "absent", state: () => createServerControllersState<Ctx>(), attempt: 1 },
  {
    name: "starting a newer attempt",
    state: () => transitionServerControllers(createServerControllersState<Ctx>(), synced(http("pw1"))).state,
    attempt: 0,
  },
  { name: "live", state: () => live("pw1"), attempt: 1 },
  { name: "unauthorized", state: () => run(live("pw1"), rejected("pw1")).state, attempt: 1 },
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
