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
import { OpencodeMemory } from "@opencode/core/plugin/provider/opencode-memory"
import { OpencodeMemoryPolicy } from "@opencode/core/plugin/provider/opencode-memory-policy"
import { Provider } from "@opencode/core/provider"
import { Session } from "@opencode/core/session"
import { SessionMessage } from "@opencode/core/session/message"
import { Tool } from "@opencode/core/tool"
import { eventually } from "../lib/eventually"
import { testEffect } from "../lib/effect"
import { PluginTestLayer } from "./fixture"

const withFlags = (overrides: string) =>
  testEffect(PluginTestLayer.pipe(Layer.provide(Layer.succeed(Flag.Overrides, overrides))))
const it = withFlags("console_memory")
const released = withFlags("-console_memory")

type Synthetic = Parameters<PluginContext.Context["session"]["synthetic"]>[0]

const author = { type: "user", id: "acc_1", label: "ada@example.com" }
const entry = (id: string, overrides: Record<string, unknown> = {}) => ({
  id,
  title: `Entry ${id}`,
  body: `Body of ${id}\nMore`,
  tags: [],
  revision: 1,
  createdBy: author,
  updatedBy: author,
  createdAt: new Date(0).toISOString(),
  updatedAt: new Date(0).toISOString(),
  ...overrides,
})
/** A search or publish hit as Console sends it. */
const hit = (id: string, score: number, snippet = `About ${id}`) => ({
  entry: { ...entry(id), snippet },
  score,
  signals: { fused: score },
})

/** Console's memory routes and config, in-process, as `docs/plans/org-library.md` in Console describes them. */
function fakeConsole() {
  const state = {
    memory: true,
    /** What search, publish's `nearest` and injection return. */
    hits: new Array<ReturnType<typeof hit>>(),
    requests: new Array<{ method: string; path: string; body?: unknown; authorization: string | null }>(),
  }
  const server = Bun.serve({
    port: 0,
    fetch: async (request) => {
      const url = new URL(request.url)
      if (url.pathname === "/api/v2/config")
        return Response.json({}, { headers: state.memory ? { [OpencodeMemory.header]: "1" } : {} })
      const body = (request.method === "GET" ? undefined : await request.json()) as Record<string, unknown> | undefined
      state.requests.push({
        method: request.method,
        path: `${url.pathname}${url.search}`,
        body,
        authorization: request.headers.get("authorization"),
      })
      if (url.pathname === "/api/memory/search") return Response.json({ results: state.hits })
      if (url.pathname === "/api/memory/inject")
        return Response.json({
          entries: state.hits.map((item, rank) => ({
            ...item,
            entry: entry(item.entry.id),
            deliveryID: `mdl_${rank}`,
          })),
        })
      if (url.pathname === "/api/memory/entries" && request.method === "POST")
        return Response.json({
          ...(body?.dryRun ? {} : { entry: entry("mem_new", { title: body?.title, body: body?.body }) }),
          nearest: state.hits,
        })
      const id = url.pathname.match(/^\/api\/memory\/entries\/(.+)$/)?.[1]
      if (id === "mem_missing") return Response.json({ _tag: "NotFound" }, { status: 404 })
      if (id && request.method === "GET") return Response.json(entry(id))
      if (id && request.method === "PATCH") {
        if (body?.expectedRevision !== 1)
          return Response.json({ _tag: "MemoryConflict", revision: 2, message: "stale" }, { status: 409 })
        return Response.json(entry(id, { ...body, revision: 2 }))
      }
      return new Response("Not found", { status: 404 })
    },
  })
  return { server, state }
}

const withConsole = <A, E, R>(use: (console: ReturnType<typeof fakeConsole>) => Effect.Effect<A, E, R>) =>
  Effect.acquireUseRelease(Effect.sync(fakeConsole), use, (console) => Effect.promise(() => console.server.stop(true)))

/** Signs in to the fake Console and starts the plugin, recording each synthetic message it admits. */
const start = Effect.fnUntraced(function* (console: ReturnType<typeof fakeConsole>) {
  const credentials = yield* Credential.Service
  yield* credentials.create({
    integrationID: Integration.ID.make("opencode"),
    value: Credential.Key.make({ type: "key", key: "secret", metadata: { server: console.server.url.origin } }),
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

const memoryTools = Effect.gen(function* () {
  const tools = yield* Tool.Service
  return (yield* tools.list()).filter((tool) => tool.options?.namespace === "memory").map((tool) => tool.name)
})

const memoryTool = (name: string) =>
  Effect.gen(function* () {
    const tools = yield* Tool.Service
    return yield* tools.list().pipe(
      Effect.map((list) => list.find((item) => item.options?.namespace === "memory" && item.name === name)),
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

describe("OpencodePlugin memory", () => {
  it.effect("offers the memory tools while the Console advertises memory, and removes them when it stops", () =>
    withConsole((console) =>
      Effect.gen(function* () {
        yield* start(console)
        expect((yield* memoryTools).toSorted()).toEqual(["publish", "read", "search", "update"])

        console.state.memory = false
        yield* TestClock.adjust("1 minute")
        yield* eventually(memoryTools, (tools) => tools.length === 0)
      }),
    ),
  )

  it.effect("offers nothing while the Console doesn't advertise memory", () =>
    withConsole((console) =>
      Effect.gen(function* () {
        console.state.memory = false
        yield* start(console)
        expect(yield* memoryTools).toEqual([])
      }),
    ),
  )

  released.effect("offers nothing while the console_memory flag is off", () =>
    withConsole((console) =>
      Effect.gen(function* () {
        yield* start(console)
        expect(yield* memoryTools).toEqual([])
      }),
    ),
  )

  it.effect("searches and reads as the signed-in member, for the session", () =>
    withConsole((console) =>
      Effect.gen(function* () {
        const { host } = yield* start(console)
        const session = yield* host.session.create({})
        console.state.hits = [hit("mem_1", 0.4, "Connect\nfirst")]

        const found = yield* (yield* memoryTool("search")).execute({ query: "deploy fails" }, context(session.id))
        expect(found.output).toEqual({
          results: [{ id: "mem_1", title: "Entry mem_1", snippet: "Connect\nfirst", revision: 1, score: 0.4 }],
        })
        expect(found.content).toBe("- mem_1: Entry mem_1 — Connect first")
        expect(console.state.requests.at(-1)).toEqual({
          method: "POST",
          path: "/api/memory/search",
          body: { query: "deploy fails", sessionID: session.id },
          authorization: "Bearer secret",
        })

        const read = yield* (yield* memoryTool("read")).execute({ id: "mem_1" }, context(session.id))
        expect(read.output).toMatchObject({ id: "mem_1", revision: 1, body: "Body of mem_1\nMore" })
        expect(read.content).toBe(
          `# Entry mem_1\n(mem_1, revision 1, updated by ada@example.com, at ${new Date(0).toISOString()})\n\nBody of mem_1\nMore`,
        )
        expect(console.state.requests.at(-1)?.path).toBe(`/api/memory/entries/mem_1?sessionID=${session.id}`)

        const missing = yield* (yield* memoryTool("read"))
          .execute({ id: "mem_missing" }, context(session.id))
          .pipe(Effect.flip)
        expect(missing.message).toBe("No such memory entry, or memory is off for this OpenCode Console workspace")
      }),
    ),
  )

  it.effect("shows close entries instead of publishing, and publishes when told none covers it", () =>
    withConsole((console) =>
      Effect.gen(function* () {
        const { host } = yield* start(console)
        const session = yield* host.session.create({})
        const publish = yield* memoryTool("publish")
        console.state.hits = [hit("mem_close", 0.9, "VPN first"), hit("mem_far", 0.1)]

        const held = yield* publish.execute({ title: "Deploy VPN", body: "Use the VPN" }, context(session.id))
        expect(held.output).toEqual({
          nearest: [{ id: "mem_close", title: "Entry mem_close", snippet: "VPN first", revision: 1, score: 0.9 }],
        })
        expect(held.content).toContain("- mem_close: Entry mem_close — VPN first")
        expect(console.state.requests).toEqual([
          {
            method: "POST",
            path: "/api/memory/entries",
            body: { title: "Deploy VPN", body: "Use the VPN", source: { sessionID: session.id }, dryRun: true },
            authorization: "Bearer secret",
          },
        ])

        const published = yield* publish.execute(
          { title: "Deploy VPN", body: "Use the VPN", distinct: true },
          context(session.id),
        )
        expect(published.output).toMatchObject({ entry: { id: "mem_new", title: "Deploy VPN" } })
        expect(published.content).toBe("Published mem_new: Deploy VPN")
        expect(console.state.requests.at(-1)?.body).toEqual({
          title: "Deploy VPN",
          body: "Use the VPN",
          source: { sessionID: session.id },
        })
      }),
    ),
  )

  it.effect("publishes at once when nothing close exists", () =>
    withConsole((console) =>
      Effect.gen(function* () {
        const { host } = yield* start(console)
        const session = yield* host.session.create({})
        console.state.hits = [hit("mem_far", 0.1)]
        const published = yield* (yield* memoryTool("publish")).execute(
          { title: "New finding", body: "Details" },
          context(session.id),
        )
        expect(published.content).toBe("Published mem_new: New finding")
        expect(console.state.requests.map((item) => (item.body as { dryRun?: boolean }).dryRun)).toEqual([
          true,
          undefined,
        ])
      }),
    ),
  )

  it.effect("updates against the revision read, and says how to recover when it changed since", () =>
    withConsole((console) =>
      Effect.gen(function* () {
        const { host } = yield* start(console)
        const session = yield* host.session.create({})
        const update = yield* memoryTool("update")

        const updated = yield* update.execute({ id: "mem_1", revision: 1, body: "Corrected" }, context(session.id))
        expect(updated.content).toBe("Updated mem_1 to revision 2: Entry mem_1")
        expect(console.state.requests.at(-1)).toMatchObject({
          method: "PATCH",
          path: "/api/memory/entries/mem_1",
          body: { expectedRevision: 1, body: "Corrected", source: { sessionID: session.id } },
        })

        const stale = yield* update
          .execute({ id: "mem_1", revision: 0, body: "Corrected" }, context(session.id))
          .pipe(Effect.flip)
        expect(stale.message).toBe(
          "The entry changed since you read it; it is at revision 2 now. Read it again, merge your change and update with that revision.",
        )
        const empty = yield* update.execute({ id: "mem_1", revision: 1 }, context(session.id)).pipe(Effect.flip)
        expect(empty.message).toBe("update takes a new title, body or both")
      }),
    ),
  )

  it.effect("injects what Console returns for the first prompt into the request after it, once", () =>
    withConsole((console) =>
      Effect.gen(function* () {
        const { host, synthetic } = yield* start(console)
        const hooks = yield* PluginHooks.Service
        const session = yield* host.session.create({})
        console.state.hits = [hit("mem_a", 0.95), hit("mem_b", 0.7)]

        yield* prompt(session.id, "  Fix the deploy ")
        const first = request(session.id, "Fix the deploy")
        yield* hooks.trigger("session", "context", first)
        expect(console.state.requests).toEqual([
          {
            method: "POST",
            path: "/api/memory/inject",
            body: { sessionID: session.id, query: "Fix the deploy" },
            authorization: "Bearer secret",
          },
        ])
        // Injections carry whole bodies, so the preview is the body's first line.
        const delivered = OpencodeMemoryPolicy.initial.render([
          { id: "mem_a", title: "Entry mem_a", snippet: "Body of mem_a", revision: 1, score: 0.95 },
          { id: "mem_b", title: "Entry mem_b", snippet: "Body of mem_b", revision: 1, score: 0.7 },
        ])
        expect(delivered).toContain("- mem_a: Entry mem_a — Body of mem_a\n- mem_b: Entry mem_b — Body of mem_b")
        expect(texts(first)).toEqual(["Fix the deploy", delivered])
        expect(synthetic).toMatchObject([
          {
            sessionID: session.id,
            text: delivered,
            description: "2 memory entries for this task",
            metadata: { source: "console.memory", entries: ["mem_a", "mem_b"] },
            resume: false,
          },
        ])

        const next = request(session.id, "Fix the deploy")
        yield* hooks.trigger("session", "context", next)
        expect(texts(next)).toEqual(["Fix the deploy"])
        expect(synthetic).toHaveLength(1)
      }),
    ),
  )

  it.effect("injects nothing when Console returns nothing or fails", () =>
    withConsole((console) =>
      Effect.gen(function* () {
        const { host, synthetic } = yield* start(console)
        const hooks = yield* PluginHooks.Service
        const quiet = yield* host.session.create({})
        yield* prompt(quiet.id, "Fix the deploy")
        const event = request(quiet.id, "Fix the deploy")
        yield* hooks.trigger("session", "context", event)
        expect(texts(event)).toEqual(["Fix the deploy"])

        console.state.hits = [{ entry: { id: "mem_bad" } } as ReturnType<typeof hit>]
        const broken = yield* host.session.create({})
        yield* prompt(broken.id, "Fix the deploy")
        const failed = request(broken.id, "Fix the deploy")
        yield* hooks.trigger("session", "context", failed)
        expect(texts(failed)).toEqual(["Fix the deploy"])
        expect(synthetic).toEqual([])
      }),
    ),
  )
})

describe("OpencodeMemoryPolicy.initial", () => {
  const session = (overrides: Record<string, unknown> = {}) =>
    ({ time: { created: 0, updated: 0 }, ...overrides }) as unknown as Session.Info

  test("injects for a new session's first prompt only, at Console's own limit and bar", () => {
    expect(OpencodeMemoryPolicy.initial.inject({ text: "  Fix the deploy  " }, session())).toEqual({
      query: "Fix the deploy",
    })
    expect(OpencodeMemoryPolicy.initial.inject({ text: "   " }, session())).toBeUndefined()
    expect(
      OpencodeMemoryPolicy.initial.inject(
        { text: "Keep going" },
        session({ time: { created: 0, updated: 0, busy: 1 } }),
      ),
    ).toBeUndefined()
    expect(
      OpencodeMemoryPolicy.initial.inject({ text: "Fix the deploy" }, session({ fork: { sessionID: "ses_parent" } })),
    ).toBeUndefined()
  })
})
