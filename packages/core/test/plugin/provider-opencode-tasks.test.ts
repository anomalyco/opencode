import { describe, expect, test } from "bun:test"
import { Duration, Effect, Exit, Layer, Scope } from "effect"
import { HttpClient } from "effect/http"
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

/** Console's claim renewal and release, in-process, as `/api/task-claims` answers: each for one session. */
function fakeConsole() {
  const state = {
    requests: new Array<{ path: string; session: string; authorization: string | null }>(),
    // How many claims a renewal finds; 0 once the session holds none.
    renewed: 1,
    // The member's lease, in minutes.
    lease: 30,
    status: 200,
    // The plugin's requests in flight: the clock must not move past its request timeout while one is.
    inflight: 0,
  }
  const server = Bun.serve({
    port: 0,
    fetch: async (request) => {
      const url = new URL(request.url)
      if (url.pathname === "/api/v2/config") return Response.json({})
      if (url.pathname !== OpencodeTasks.RENEW_PATH && url.pathname !== OpencodeTasks.RELEASE_PATH)
        return new Response("Not found", { status: 404 })
      const body = (await request.json()) as { session: string }
      state.requests.push({
        path: url.pathname,
        session: body.session,
        authorization: request.headers.get("authorization"),
      })
      if (state.status !== 200) return Response.json({ _tag: "Refused" }, { status: state.status })
      if (url.pathname === OpencodeTasks.RELEASE_PATH) return Response.json({ released: 1 })
      return Response.json({
        renewed: state.renewed,
        leaseExpiresAt: state.renewed === 0 ? null : new Date(Date.now() + state.lease * 60_000).toISOString(),
        leaseMinutes: state.lease,
      })
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

/** Starts the plugin, in `scope` so a test can stop it as a restart would, counting its requests in flight. */
const start = Effect.fnUntraced(function* (console: FakeConsole, scope?: Scope.Scope) {
  const host = yield* PluginHost.make(yield* Plugin.Service, "test")
  const http = HttpClient.transform(yield* HttpClient.HttpClient, (response) =>
    Effect.acquireUseRelease(
      Effect.sync(() => console.state.inflight++),
      () => response,
      () => Effect.sync(() => console.state.inflight--),
    ),
  )
  const plugin = OpencodePlugin.effect(host).pipe(Effect.provideService(HttpClient.HttpClient, http))
  yield* scope ? plugin.pipe(Scope.provide(scope)) : plugin
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

// Steps shorter than the plugin's 10-second request timeout: an adjust also fires the sleeps registered while it runs,
// so a renewal it wakes must not see its own timeout pass within the same step.
const STEP = "5 seconds"

// Lets real work finish between clock steps, with no request in flight, so a request never spans a step either.
const settle = (console: FakeConsole) =>
  Effect.promise(async () => {
    await Bun.sleep(2)
    while (console.state.inflight > 0) await Bun.sleep(1)
    await Bun.sleep(2)
  })

/** Steps the clock until Console has seen `count` requests in all, bounded by real time. */
const until = Effect.fnUntraced(function* (console: FakeConsole, count: number) {
  const deadline = Date.now() + 10_000
  while (console.state.requests.length < count) {
    if (Date.now() > deadline)
      return yield* Effect.die(new Error(`Console saw ${console.state.requests.length} requests`))
    yield* settle(console)
    yield* TestClock.adjust(STEP)
  }
  yield* settle(console)
})

/** Steps the clock through `minutes`, for asserting what was sent meanwhile. */
const pass = Effect.fnUntraced(function* (console: FakeConsole, minutes: number) {
  for (let step = 0; step < minutes * 12; step++) {
    yield* settle(console)
    yield* TestClock.adjust(STEP)
  }
  yield* settle(console)
})

describe("OpencodePlugin task claims", () => {
  it.effect("renews a claiming session's claims in the background until Console finds none left", () =>
    withConsole((console) =>
      Effect.gen(function* () {
        yield* signIn(console)
        const host = yield* start(console)
        const claiming = yield* host.session.create({})
        const other = yield* host.session.create({})
        console.state.lease = 5
        yield* claim(claiming.id)
        // Only Console's own claim tool counts.
        yield* claim(other.id, "linear_claim_task")

        yield* until(console, 1)
        expect(console.state.requests).toEqual([
          { path: OpencodeTasks.RENEW_PATH, session: claiming.id, authorization: "Bearer secret" },
        ])
        console.state.renewed = 0
        yield* until(console, 2)
        yield* pass(console, 6)
        expect(sent(console, OpencodeTasks.RENEW_PATH)).toEqual([claiming.id, claiming.id])
      }),
    ),
  )

  it.effect("releases a session's claims when it is archived or deleted", () =>
    withConsole((console) =>
      Effect.gen(function* () {
        yield* signIn(console)
        const host = yield* start(console)
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
        yield* pass(console, 6)
        expect(sent(console, OpencodeTasks.RENEW_PATH)).toEqual([])
      }),
    ),
  )

  test("waits a third of the member's lease between renewals, at most 10 minutes, give or take a tenth", () => {
    const minutes = (lease: number) => Duration.toMillis(OpencodeTasks.interval(lease)) / 60_000
    Array.from({ length: 50 }).forEach(() => {
      expect(minutes(30)).toBeWithin(9, 11.0001)
      expect(minutes(9)).toBeWithin(2.7, 3.3001)
      expect(minutes(1440)).toBeWithin(9, 11.0001)
      // Shorter than a member may choose: the shortest, 5 minutes, which is also what's assumed before Console answers.
      expect(minutes(1)).toBeWithin(1.5, 1.8334)
    })
  })

  it.effect("renews on the member's lease once Console names it, after assuming the shortest", () =>
    withConsole((console) =>
      Effect.gen(function* () {
        yield* signIn(console)
        const host = yield* start(console)
        const session = yield* host.session.create({})
        console.state.lease = 9
        yield* claim(session.id)

        // Within a third of the shortest lease: 90 to 110 seconds.
        yield* pass(console, 1.5)
        expect(console.state.requests).toHaveLength(0)
        yield* pass(console, 0.5)
        expect(console.state.requests).toHaveLength(1)
        // Then a third of the member's 9 minutes, 162 to 198 seconds: the next comes 252 to 308 seconds in.
        yield* pass(console, 2)
        expect(console.state.requests).toHaveLength(1)
        yield* pass(console, 1.5)
        expect(console.state.requests).toHaveLength(2)
      }),
    ),
  )

  it.effect("retries a failed renewal with backoff, then returns to the interval", () =>
    withConsole((console) =>
      Effect.gen(function* () {
        yield* signIn(console)
        const host = yield* start(console)
        const session = yield* host.session.create({})
        console.state.lease = 9
        console.state.status = 500
        yield* claim(session.id)

        yield* until(console, 1)
        // Retried 30 seconds later, then a minute after that.
        yield* pass(console, 0.5)
        expect(console.state.requests).toHaveLength(2)
        yield* pass(console, 0.75)
        expect(console.state.requests).toHaveLength(2)
        yield* pass(console, 0.25)
        expect(console.state.requests).toHaveLength(3)
        console.state.status = 200
        // Then every third of the shortest lease until one succeeds, 90 to 110 seconds.
        yield* pass(console, 2)
        expect(console.state.requests).toHaveLength(4)
        // Back on the member's 9 minutes, 162 to 198 seconds after the one that succeeded: nothing for 2 minutes.
        yield* pass(console, 2)
        expect(console.state.requests).toHaveLength(4)
        expect(new Set(sent(console, OpencodeTasks.RENEW_PATH))).toEqual(new Set([session.id]))
      }),
    ),
  )

  for (const [status, reason] of [
    [404, "Tasks are off"],
    [403, "the sign-in keeps no list"],
  ] as const)
    it.effect(`stops renewing once Console answers ${status}: ${reason}`, () =>
      withConsole((console) =>
        Effect.gen(function* () {
          yield* signIn(console)
          const host = yield* start(console)
          const session = yield* host.session.create({})
          yield* claim(session.id)

          console.state.status = status
          yield* until(console, 1)
          yield* pass(console, 6)
          expect(console.state.requests).toHaveLength(1)
        }),
      ),
    )

  it.effect("after a restart, renews remembered claims at once and releases those of sessions deleted meanwhile", () =>
    withConsole((console) =>
      Effect.gen(function* () {
        yield* signIn(console)
        const first = yield* Scope.make()
        const host = yield* start(console, first)
        const kept = yield* host.session.create({})
        const gone = yield* host.session.create({})
        yield* claim(kept.id)
        yield* claim(gone.id)
        yield* Scope.close(first, Exit.void)
        yield* host.session.remove({ sessionID: gone.id })
        expect(console.state.requests).toEqual([])

        yield* start(console)
        yield* until(console, 2)
        expect(sent(console, OpencodeTasks.RENEW_PATH)).toEqual([kept.id])
        expect(sent(console, OpencodeTasks.RELEASE_PATH)).toEqual([gone.id])
      }),
    ),
  )

  released.effect("does nothing while the console_tasks flag is off", () =>
    withConsole((console) =>
      Effect.gen(function* () {
        yield* signIn(console)
        const host = yield* start(console)
        const session = yield* host.session.create({})
        yield* claim(session.id)
        yield* pass(console, 6)
        expect(console.state.requests).toEqual([])
      }),
    ),
  )
})
