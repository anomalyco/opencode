import { describe, expect, test } from "bun:test"
import { Message, SystemPart } from "@opencode/ai/effect"
import type { Plugin as PluginContext } from "@opencode/plugin/effect"
import type { SessionHooks } from "@opencode/plugin/effect/session"
import { Model } from "@opencode/schema/model"
import { Effect, Layer } from "effect"
import { TestClock } from "effect/testing"
import { Agent } from "@opencode/core/agent"
import { Credential } from "@opencode/core/credential"
import { Flag } from "@opencode/core/flag"
import { Integration } from "@opencode/core/integration"
import { Plugin } from "@opencode/core/plugin"
import { PluginHooks } from "@opencode/core/plugin/hooks"
import { PluginHost } from "@opencode/core/plugin/host"
import { OpencodePlugin } from "@opencode/core/plugin/provider/opencode"
import { OpencodeLibrary } from "@opencode/core/plugin/provider/opencode-library"
import { OpencodeLibraryPolicy } from "@opencode/core/plugin/provider/opencode-library-policy"
import { Provider } from "@opencode/core/provider"
import { Session } from "@opencode/core/session"
import { SessionMessage } from "@opencode/core/session/message"
import { Tool } from "@opencode/core/tool"
import { withEnv } from "../fixture/env"
import { eventually } from "../lib/eventually"
import { testEffect } from "../lib/effect"
import { PluginTestLayer } from "./fixture"

const withFlags = (overrides: string) =>
  testEffect(PluginTestLayer.pipe(Layer.provide(Layer.succeed(Flag.Overrides, overrides))))
const it = withFlags("console_library")
const released = withFlags("-console_library")

type Synthetic = Parameters<PluginContext.Context["session"]["synthetic"]>[0]
type Hit = OpencodeLibraryPolicy.Hit

const entry = (id: string, title = `Entry ${id}`) => ({
  id,
  title,
  body: `Body of ${id}`,
  author: "ada@example.com",
  updatedAt: new Date(0).toISOString(),
})

/**
 * The library routes and the Console config, in-process. The config advertises the library with `header` while it is
 * set; library routes answer under any prefix, so a library at another address is the same server under a path.
 */
function fakeLibrary() {
  const state = {
    header: "1" as string | undefined,
    hits: new Array<Hit>(),
    requests: new Array<{ method: string; path: string; body?: unknown; authorization: string | null }>(),
    usage: new Array<Record<string, unknown>>(),
  }
  const server = Bun.serve({
    port: 0,
    fetch: async (request) => {
      const url = new URL(request.url)
      if (url.pathname === "/api/v2/config")
        return Response.json({}, { headers: state.header ? { [OpencodeLibrary.header]: state.header } : {} })
      const body = request.method === "GET" ? undefined : await request.json()
      state.requests.push({
        method: request.method,
        path: url.pathname,
        body,
        authorization: request.headers.get("authorization"),
      })
      const path = url.pathname.replace(/^.*(?=\/api\/library\/)/, "")
      if (path === "/api/library/search") return Response.json({ entries: state.hits })
      if (path === "/api/library/usage") {
        state.usage.push(...(body as { events: Record<string, unknown>[] }).events)
        return new Response(null, { status: 204 })
      }
      if (path === "/api/library/entries" && request.method === "POST")
        return Response.json({ ...entry("lib_new"), ...(body as object) })
      const id = path.match(/^\/api\/library\/entries\/(.+)$/)?.[1]
      if (id === "lib_missing") return Response.json({ message: "No entry lib_missing" }, { status: 404 })
      if (id && request.method === "GET") return Response.json(entry(id))
      if (id && request.method === "PATCH") return Response.json({ ...entry(id), ...(body as object) })
      return new Response("Not found", { status: 404 })
    },
  })
  return { server, state }
}

const withLibrary = <A, E, R>(use: (library: ReturnType<typeof fakeLibrary>) => Effect.Effect<A, E, R>) =>
  Effect.acquireUseRelease(Effect.sync(fakeLibrary), use, (library) => Effect.promise(() => library.server.stop(true)))

/** Signs in to the fake Console and starts the plugin, recording each synthetic message it admits. */
const start = Effect.fnUntraced(function* (library: ReturnType<typeof fakeLibrary>) {
  const credentials = yield* Credential.Service
  yield* credentials.create({
    integrationID: Integration.ID.make("opencode"),
    value: Credential.Key.make({ type: "key", key: "secret", metadata: { server: library.server.url.origin } }),
  })
  const real = yield* PluginHost.make(yield* Plugin.Service, "test")
  const synthetic = new Array<Synthetic>()
  const host: PluginContext.Context = {
    ...real,
    session: {
      ...real.session,
      synthetic: (input) => {
        synthetic.push(input)
        return real.session.synthetic(input)
      },
    },
  }
  yield* OpencodePlugin.effect(host)
  return { host, synthetic }
})

const libraryTools = Effect.gen(function* () {
  const tools = yield* Tool.Service
  return (yield* tools.list()).filter((tool) => tool.options?.namespace === "library").map((tool) => tool.name)
})

const libraryTool = (name: string) =>
  Effect.gen(function* () {
    const tools = yield* Tool.Service
    return yield* tools.list().pipe(
      Effect.map((list) => list.find((item) => item.options?.namespace === "library" && item.name === name)),
      Effect.flatMap(Effect.fromNullishOr),
    )
  })

const context = (sessionID: Session.ID): Tool.Context => ({
  sessionID,
  agent: Agent.ID.make("build"),
  messageID: SessionMessage.ID.create(),
  id: Tool.CallID.make("call_1"),
  progress: () => Effect.void,
})

const request = (sessionID: Session.ID, text: string): SessionHooks["context"] => ({
  sessionID,
  agent: Agent.ID.make("build"),
  model: Model.Ref.make({ providerID: Provider.ID.make("test"), id: Model.ID.make("test") }),
  system: [SystemPart.make("Agent prompt")],
  messages: [Message.user(text)],
  tools: {},
  options: {},
})

const prompt = (sessionID: Session.ID, text: string) =>
  Effect.gen(function* () {
    const hooks = yield* PluginHooks.Service
    yield* hooks.trigger("session", "prompt", {
      sessionID,
      messageID: SessionMessage.ID.create(),
      prompt: { text },
      delivery: "steer",
    })
  })

const texts = (event: SessionHooks["context"]) =>
  event.messages.map((message) => message.content.map((part) => (part.type === "text" ? part.text : "")).join(""))

describe("OpencodePlugin library", () => {
  it.effect("offers the library tools while the Console advertises a library, and removes them when it stops", () =>
    withLibrary((library) =>
      Effect.gen(function* () {
        yield* start(library)
        expect((yield* libraryTools).toSorted()).toEqual(["publish", "read", "search", "update"])

        library.state.header = undefined
        yield* TestClock.adjust("1 minute")
        yield* eventually(libraryTools, (tools) => tools.length === 0)
      }),
    ),
  )

  it.effect("offers nothing while the Console doesn't advertise a library", () =>
    withLibrary((library) =>
      Effect.gen(function* () {
        library.state.header = undefined
        yield* start(library)
        expect(yield* libraryTools).toEqual([])
      }),
    ),
  )

  released.effect("offers nothing while the console_library flag is off", () =>
    withLibrary((library) =>
      Effect.gen(function* () {
        yield* start(library)
        expect(yield* libraryTools).toEqual([])
      }),
    ),
  )

  it.effect("searches and reads as the signed-in member, and logs the open", () =>
    withLibrary((library) =>
      Effect.gen(function* () {
        const { host } = yield* start(library)
        const session = yield* host.session.create({})
        library.state.hits = [{ id: "lib_1", title: "Deploys need\nthe VPN", preview: "Connect first", score: 0.4 }]

        const found = yield* (yield* libraryTool("search")).execute({ query: "deploy fails" }, context(session.id))
        expect(found.content).toBe("- lib_1: Deploys need the VPN — Connect first")
        expect(library.state.requests.at(-1)).toMatchObject({
          method: "POST",
          path: "/api/library/search",
          body: { query: "deploy fails", limit: 5 },
          authorization: "Bearer secret",
        })

        const read = yield* (yield* libraryTool("read")).execute({ id: "lib_1" }, context(session.id))
        expect(read.output).toEqual(entry("lib_1"))
        expect(read.content).toContain("Body of lib_1")
        yield* eventually(
          Effect.sync(() => library.state.usage),
          (usage) => usage.length === 1,
        )
        expect(library.state.usage).toEqual([{ kind: "opened", entryID: "lib_1", sessionID: session.id }])

        const missing = yield* (yield* libraryTool("read"))
          .execute({ id: "lib_missing" }, context(session.id))
          .pipe(Effect.flip)
        expect(missing.message).toBe("No entry lib_missing")
      }),
    ),
  )

  it.effect("shows close entries instead of publishing, and publishes when told none covers it", () =>
    withLibrary((library) =>
      Effect.gen(function* () {
        const { host } = yield* start(library)
        const session = yield* host.session.create({})
        const publish = yield* libraryTool("publish")
        library.state.hits = [
          { id: "lib_close", title: "VPN for deploys", score: 0.9 },
          { id: "lib_far", title: "Unrelated", score: 0.1 },
        ]

        const held = yield* publish.execute({ title: "Deploy VPN", body: "Use the VPN" }, context(session.id))
        expect(held.output).toEqual({ similar: [{ id: "lib_close", title: "VPN for deploys", score: 0.9 }] })
        expect(held.content).toContain("- lib_close: VPN for deploys")
        expect(library.state.requests.some((item) => item.path === "/api/library/entries")).toBe(false)

        const published = yield* publish.execute(
          { title: "Deploy VPN", body: "Use the VPN", distinct: true },
          context(session.id),
        )
        expect(published.output).toMatchObject({ entry: { id: "lib_new", title: "Deploy VPN" }, similar: [] })
        expect(library.state.requests.at(-1)).toMatchObject({
          method: "POST",
          path: "/api/library/entries",
          body: { title: "Deploy VPN", body: "Use the VPN" },
        })
      }),
    ),
  )

  it.effect("publishes at once when nothing close exists, and updates only the fields given", () =>
    withLibrary((library) =>
      Effect.gen(function* () {
        const { host } = yield* start(library)
        const session = yield* host.session.create({})
        library.state.hits = [{ id: "lib_far", title: "Unrelated", score: 0.1 }]
        const published = yield* (yield* libraryTool("publish")).execute(
          { title: "New finding", body: "Details" },
          context(session.id),
        )
        expect(published.content).toBe("Published lib_new: New finding")

        const update = yield* libraryTool("update")
        const updated = yield* update.execute({ id: "lib_1", body: "Corrected" }, context(session.id))
        expect(updated.output).toMatchObject({ id: "lib_1", body: "Corrected" })
        expect(library.state.requests.at(-1)).toMatchObject({
          method: "PATCH",
          path: "/api/library/entries/lib_1",
          body: { body: "Corrected" },
        })
        const empty = yield* update.execute({ id: "lib_1" }, context(session.id)).pipe(Effect.flip)
        expect(empty.message).toBe("update takes a new title, body or both")
      }),
    ),
  )

  it.effect("delivers the entries above the bar to the request after the first prompt, once, and logs them", () =>
    withLibrary((library) =>
      Effect.gen(function* () {
        const { host, synthetic } = yield* start(library)
        const hooks = yield* PluginHooks.Service
        const session = yield* host.session.create({})
        library.state.hits = [
          { id: "lib_a", title: "A", preview: "first", score: 0.95 },
          { id: "lib_b", title: "B", score: 0.7 },
          { id: "lib_c", title: "C", score: 0.65 },
          { id: "lib_d", title: "D", score: 0.62 },
          { id: "lib_low", title: "Low", score: 0.2 },
        ]

        yield* prompt(session.id, "Fix the deploy")
        const first = request(session.id, "Fix the deploy")
        yield* hooks.trigger("session", "context", first)
        expect(library.state.requests[0]?.body).toEqual({ query: "Fix the deploy", limit: 6 })
        const delivered = OpencodeLibraryPolicy.initial.render(library.state.hits.slice(0, 3))
        expect(texts(first)).toEqual(["Fix the deploy", delivered])
        expect(delivered).toContain("- lib_a: A — first\n- lib_b: B\n- lib_c: C")
        expect(synthetic).toMatchObject([
          {
            sessionID: session.id,
            text: delivered,
            metadata: { source: "library", entries: ["lib_a", "lib_b", "lib_c"] },
            resume: false,
          },
        ])
        yield* eventually(
          Effect.sync(() => library.state.usage),
          (usage) => usage.length === 3,
        )
        expect(library.state.usage).toEqual([
          { kind: "delivered", entryID: "lib_a", sessionID: session.id, score: 0.95, rank: 0 },
          { kind: "delivered", entryID: "lib_b", sessionID: session.id, score: 0.7, rank: 1 },
          { kind: "delivered", entryID: "lib_c", sessionID: session.id, score: 0.65, rank: 2 },
        ])

        const next = request(session.id, "Fix the deploy")
        yield* hooks.trigger("session", "context", next)
        expect(texts(next)).toEqual(["Fix the deploy"])
        expect(synthetic).toHaveLength(1)
      }),
    ),
  )

  it.effect("delivers nothing when no entry clears the bar or the library fails", () =>
    withLibrary((library) =>
      Effect.gen(function* () {
        const { host, synthetic } = yield* start(library)
        const hooks = yield* PluginHooks.Service
        library.state.hits = [{ id: "lib_low", title: "Low", score: 0.3 }]
        const quiet = yield* host.session.create({})
        yield* prompt(quiet.id, "Fix the deploy")
        const event = request(quiet.id, "Fix the deploy")
        yield* hooks.trigger("session", "context", event)
        expect(texts(event)).toEqual(["Fix the deploy"])

        library.state.hits = [{ id: "lib_bad" } as Hit]
        const broken = yield* host.session.create({})
        yield* prompt(broken.id, "Fix the deploy")
        const failed = request(broken.id, "Fix the deploy")
        yield* hooks.trigger("session", "context", failed)
        expect(texts(failed)).toEqual(["Fix the deploy"])
        expect(synthetic).toEqual([])
      }),
    ),
  )

  it.effect("talks to the library at the address the Console names", () =>
    withLibrary((library) =>
      Effect.gen(function* () {
        library.state.header = `${library.server.url.origin}/org-library/`
        const { host } = yield* start(library)
        const session = yield* host.session.create({})
        yield* (yield* libraryTool("search")).execute({ query: "deploy" }, context(session.id))
        expect(library.state.requests.at(-1)?.path).toBe("/org-library/api/library/search")
      }),
    ),
  )

  it.effect("connects to OPENCODE_LIBRARY_URL even while the Console advertises no library", () =>
    withLibrary((library) =>
      withEnv({ OPENCODE_LIBRARY_URL: `${library.server.url.origin}/dev` }, () =>
        Effect.gen(function* () {
          library.state.header = undefined
          const { host } = yield* start(library)
          const session = yield* host.session.create({})
          yield* (yield* libraryTool("search")).execute({ query: "deploy" }, context(session.id))
          expect(library.state.requests.at(-1)).toMatchObject({
            path: "/dev/api/library/search",
            authorization: "Bearer secret",
          })
        }),
      ),
    ),
  )
})

describe("OpencodeLibraryPolicy.initial", () => {
  const session = (overrides: Partial<Session.Info> = {}) =>
    ({ time: { created: 0, updated: 0 }, ...overrides }) as unknown as Session.Info

  test("queries with a new session's first prompt only", () => {
    expect(OpencodeLibraryPolicy.initial.query({ text: "  Fix the deploy  " }, session())).toEqual({
      text: "Fix the deploy",
      limit: 6,
    })
    expect(OpencodeLibraryPolicy.initial.query({ text: "   " }, session())).toBeUndefined()
    expect(
      OpencodeLibraryPolicy.initial.query(
        { text: "Keep going" },
        session({ time: { created: 0, updated: 0, busy: 1 } } as unknown as Partial<Session.Info>),
      ),
    ).toBeUndefined()
    expect(
      OpencodeLibraryPolicy.initial.query(
        { text: "Fix the deploy" },
        session({ fork: { sessionID: "ses_parent" } } as unknown as Partial<Session.Info>),
      ),
    ).toBeUndefined()
  })
})
