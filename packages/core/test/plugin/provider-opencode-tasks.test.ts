import { describe, expect } from "bun:test"
import { Effect, Exit, Layer, Scope } from "effect"
import { TestClock } from "effect/testing"
import { Agent } from "@opencode/core/agent"
import { Credential } from "@opencode/core/credential"
import { Flag } from "@opencode/core/flag"
import { Integration } from "@opencode/core/integration"
import { Plugin } from "@opencode/core/plugin"
import { PluginHooks } from "@opencode/core/plugin/hooks"
import { PluginHost } from "@opencode/core/plugin/host"
import { OpencodePlugin } from "@opencode/core/plugin/provider/opencode"
import { OpencodeTasks } from "@opencode/core/plugin/provider/opencode-tasks"
import { Session } from "@opencode/core/session"
import { SessionMessage } from "@opencode/core/session/message"
import { Tool } from "@opencode/core/tool"
import { testEffect } from "../lib/effect"
import { PluginTestLayer } from "./fixture"

const withFlags = (overrides: string) =>
  testEffect(PluginTestLayer.pipe(Layer.provide(Layer.succeed(Flag.Overrides, overrides))))
const it = withFlags("console_tasks")
const released = withFlags("-console_tasks")

/** Console's claim heartbeat and release, in-process: each answers for one session. */
function fakeConsole() {
  const state = {
    requests: new Array<{ path: string; session: string; authorization: string | null }>(),
    // How many claims a heartbeat finds; 0 once the session holds none.
    renewed: 1,
    status: 200,
  }
  const server = Bun.serve({
    port: 0,
    fetch: async (request) => {
      const url = new URL(request.url)
      if (url.pathname === "/api/v2/config") return Response.json({})
      if (url.pathname !== OpencodeTasks.HEARTBEAT_PATH && url.pathname !== OpencodeTasks.RELEASE_PATH)
        return new Response("Not found", { status: 404 })
      const body = (await request.json()) as { session: string }
      state.requests.push({
        path: url.pathname,
        session: body.session,
        authorization: request.headers.get("authorization"),
      })
      if (state.status !== 200) return new Response("No", { status: state.status })
      return Response.json(url.pathname === OpencodeTasks.HEARTBEAT_PATH ? { renewed: state.renewed } : { released: 1 })
    },
  })
  return { server, state }
}

type FakeConsole = ReturnType<typeof fakeConsole>

const withConsole = <A, E, R>(use: (console: FakeConsole) => Effect.Effect<A, E, R>) =>
  Effect.acquireUseRelease(Effect.sync(fakeConsole), use, (console) => Effect.promise(() => console.server.stop(true)))

const signIn = Effect.fnUntraced(function* (console: FakeConsole) {
  const credentials = yield* Credential.Service
  yield* credentials.create({
    integrationID: Integration.ID.make("opencode"),
    value: Credential.Key.make({ type: "key", key: "secret", metadata: { server: console.server.url.origin } }),
  })
})

/** Starts the plugin in `scope`, so a test can stop it as a restart would. */
const start = Effect.fnUntraced(function* (scope?: Scope.Scope) {
  const host = yield* PluginHost.make(yield* Plugin.Service, "test")
  yield* scope ? OpencodePlugin.effect(host).pipe(Scope.provide(scope)) : OpencodePlugin.effect(host)
  return host
})

const claim = Effect.fnUntraced(function* (sessionID: Session.ID, tool: string = OpencodeTasks.CLAIM_TOOL) {
  const hooks = yield* PluginHooks.Service
  yield* hooks.trigger("tool", "execute.after", {
    tool,
    codemode: false,
    sessionID,
    agent: Agent.ID.make("build"),
    messageID: SessionMessage.ID.create(),
    id: Tool.CallID.make("call_claim"),
    input: {},
    status: "completed",
    result: { output: { id: "tsk_1", status: "in_progress", claimed_by_session: sessionID } },
  })
})

const sent = (console: FakeConsole, path: string) =>
  console.state.requests.filter((request) => request.path === path).map((request) => request.session)

// Lets real work (requests, fiber hops) finish between clock steps, so the loop's next sleep is registered first.
const settle = Effect.promise(() => Bun.sleep(5))

/** Steps the clock 30 seconds at a time until Console has seen `count` requests in all, bounded by real time. */
const until = Effect.fnUntraced(function* (console: FakeConsole, count: number) {
  const deadline = Date.now() + 10_000
  while (console.state.requests.length < count) {
    if (Date.now() > deadline)
      return yield* Effect.die(new Error(`Console saw ${console.state.requests.length} requests`))
    yield* settle
    yield* TestClock.adjust("30 seconds")
  }
  yield* settle
})

/** Steps the clock through `minutes`, for asserting that nothing more was sent. */
const pass = Effect.fnUntraced(function* (minutes: number) {
  for (let step = 0; step < minutes * 2; step++) {
    yield* settle
    yield* TestClock.adjust("30 seconds")
  }
  yield* settle
})

describe("OpencodePlugin task claims", () => {
  it.effect("renews a claiming session's claims in the background until Console finds none left", () =>
    withConsole((console) =>
      Effect.gen(function* () {
        yield* signIn(console)
        const host = yield* start()
        const claiming = yield* host.session.create({})
        const other = yield* host.session.create({})
        yield* claim(claiming.id)
        // Only Console's own claim tool counts.
        yield* claim(other.id, "linear_claim_task")

        yield* until(console, 1)
        expect(console.state.requests).toEqual([
          { path: OpencodeTasks.HEARTBEAT_PATH, session: claiming.id, authorization: "Bearer secret" },
        ])
        console.state.renewed = 0
        yield* until(console, 2)
        yield* pass(15)
        expect(sent(console, OpencodeTasks.HEARTBEAT_PATH)).toEqual([claiming.id, claiming.id])
      }),
    ),
  )

  it.effect("releases a session's claims when it is archived or deleted", () =>
    withConsole((console) =>
      Effect.gen(function* () {
        yield* signIn(console)
        const host = yield* start()
        const sessions = yield* Session.Service
        const archived = yield* host.session.create({})
        const deleted = yield* host.session.create({})
        const untouched = yield* host.session.create({})
        yield* claim(archived.id)
        yield* claim(deleted.id)

        yield* sessions.archive(archived.id)
        yield* host.session.remove({ sessionID: deleted.id })
        yield* host.session.remove({ sessionID: untouched.id })
        yield* until(console, 2)
        expect(sent(console, OpencodeTasks.RELEASE_PATH).toSorted()).toEqual([archived.id, deleted.id].toSorted())

        // Released sessions aren't renewed.
        yield* pass(15)
        expect(sent(console, OpencodeTasks.HEARTBEAT_PATH)).toEqual([])
      }),
    ),
  )

  it.effect("retries a failed heartbeat with backoff, then returns to the interval", () =>
    withConsole((console) =>
      Effect.gen(function* () {
        yield* signIn(console)
        const host = yield* start()
        const session = yield* host.session.create({})
        yield* claim(session.id)

        console.state.status = 500
        yield* until(console, 1)
        // The first retry follows 30 seconds later, the second a minute after that.
        yield* pass(0.5)
        expect(console.state.requests).toHaveLength(2)
        console.state.status = 200
        yield* pass(0.5)
        expect(console.state.requests).toHaveLength(2)
        yield* pass(0.5)
        expect(console.state.requests).toHaveLength(3)
        // Back on the interval: nothing more within the next three minutes.
        yield* pass(3)
        expect(sent(console, OpencodeTasks.HEARTBEAT_PATH)).toEqual([session.id, session.id, session.id])
      }),
    ),
  )

  it.effect("stops renewing once Console answers that Tasks are off", () =>
    withConsole((console) =>
      Effect.gen(function* () {
        yield* signIn(console)
        const host = yield* start()
        const session = yield* host.session.create({})
        yield* claim(session.id)

        console.state.status = 404
        yield* until(console, 1)
        yield* pass(15)
        expect(console.state.requests).toHaveLength(1)
      }),
    ),
  )

  it.effect("after a restart, renews remembered claims at once and releases those of sessions deleted meanwhile", () =>
    withConsole((console) =>
      Effect.gen(function* () {
        yield* signIn(console)
        const first = yield* Scope.make()
        const host = yield* start(first)
        const kept = yield* host.session.create({})
        const gone = yield* host.session.create({})
        yield* claim(kept.id)
        yield* claim(gone.id)
        yield* Scope.close(first, Exit.void)
        yield* host.session.remove({ sessionID: gone.id })
        expect(console.state.requests).toEqual([])

        yield* start()
        yield* until(console, 2)
        expect(sent(console, OpencodeTasks.HEARTBEAT_PATH)).toEqual([kept.id])
        expect(sent(console, OpencodeTasks.RELEASE_PATH)).toEqual([gone.id])
      }),
    ),
  )

  released.effect("does nothing while the console_tasks flag is off", () =>
    withConsole((console) =>
      Effect.gen(function* () {
        yield* signIn(console)
        const host = yield* start()
        const session = yield* host.session.create({})
        yield* claim(session.id)
        yield* pass(15)
        expect(console.state.requests).toEqual([])
      }),
    ),
  )
})
