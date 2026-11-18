import { describe, expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { $ } from "bun"
import { Message, SystemPart } from "@opencode/ai/effect"
import type { Plugin as PluginContext } from "@opencode/plugin/effect"
import type { SessionHooks } from "@opencode/plugin/effect/session"
import { Model } from "@opencode/schema/model"
import { Effect, Layer, Queue, Stream } from "effect"
import { TestClock } from "effect/testing"
import { Agent } from "@opencode/core/agent"
import { Credential } from "@opencode/core/credential"
import { Flag } from "@opencode/core/flag"
import { Integration } from "@opencode/core/integration"
import { Location } from "@opencode/core/location"
import { Plugin } from "@opencode/core/plugin"
import { PluginHooks } from "@opencode/core/plugin/hooks"
import { PluginHost } from "@opencode/core/plugin/host"
import { OpencodePlugin } from "@opencode/core/plugin/provider/opencode"
import { OpencodeMemoryAccess } from "@opencode/core/plugin/provider/opencode-memory-access"
import { OpencodeMemory } from "@opencode/core/plugin/provider/opencode-memory"
import { OpencodeMemoryPolicy } from "@opencode/core/plugin/provider/opencode-memory-policy"
import { Provider } from "@opencode/core/provider"
import { Session } from "@opencode/core/session"
import { SessionMessage } from "@opencode/core/session/message"
import { Tool } from "@opencode/core/tool"
import { initGit } from "../fixture/git"
import { eventually } from "../lib/eventually"
import { testEffect } from "../lib/effect"
import { PluginTestLayer } from "./fixture"

const withFlags = (overrides: string) =>
  testEffect(PluginTestLayer.pipe(Layer.provide(Layer.succeed(Flag.Overrides, overrides))))
const it = withFlags("console_memory")
const released = withFlags("-console_memory")

type Synthetic = Parameters<PluginContext.Context["session"]["synthetic"]>[0]

const author = { type: "user", id: "acc_1", label: "ada@example.com" }
/** An entry as Console's `GET /api/memory/entries/:id` answers it. */
const entry = (id: string, overrides: Record<string, unknown> = {}) => ({
  id,
  kind: "bug",
  title: `Entry ${id}`,
  body: `Body of ${id}\nMore`,
  tags: ["deploy"],
  paths: ["apps/worker/"],
  errors: ["ERR_DEPLOY"],
  repo: "github.com/acme/app",
  revision: 1,
  createdBy: author,
  updatedBy: author,
  createdAt: new Date(0).toISOString(),
  updatedAt: new Date(0).toISOString(),
  source: { repo: "github.com/acme/app", branch: "main", commitSha: "abc123" },
  ...overrides,
})
/** A search or publish hit as Console sends it: compact, no body. */
const hit = (id: string, score: number, snippet = `About ${id}`) => ({
  id,
  kind: "bug",
  title: `Entry ${id}`,
  snippet,
  revision: 1,
  score,
})
/** An injected entry as Console sends it: whole body, logged as delivered. */
const injected = (id: string, score: number, revision = 1) => ({
  id,
  kind: "bug" as const,
  title: `Entry ${id}`,
  body: `Body of ${id}\nMore`,
  revision,
  updatedAt: new Date(0).toISOString(),
  score,
  deliveryID: `mdl_${id}`,
})

/**
 * Console's memory routes and config, in-process, with the request and response shapes and error tags of Console's
 * contract (`docs/plans/org-library.md`, server commits a902a4fea and 1695a6575).
 */
function fakeConsole() {
  const state = {
    memory: true,
    hits: new Array<ReturnType<typeof hit>>(),
    injected: new Array<ReturnType<typeof injected>>(),
    /** An entry close enough to refuse a publish without `distinctFrom`. */
    duplicate: undefined as ReturnType<typeof hit> | undefined,
    /** Publishes saved, by idempotency key: the same key answers the first one's result. */
    published: new Map<string, { id: string; revision: number }>(),
    matched: undefined as string[] | undefined,
    /** Each entry's current revision, 1 until written. */
    revisions: new Map<string, number>(),
    /** Applies a write over changes since its revision, as Console does when they don't touch it. */
    rebase: false,
    requests: new Array<{ method: string; path: string; body?: unknown; authorization: string | null }>(),
    /** The restricted repositories Console lists, as `host/id`. */
    anchors: new Array<string>(),
    /** GitHub, served here too: repositories by `owner/name`, and which ids the reader's credential can read. */
    repositories: new Map<string, { id: number; visibility: string }>(),
    readable: new Set<number>(),
    github: new Array<{ path: string; authorization: string | null }>(),
  }
  const refuse = (status: number, error: Record<string, unknown> & { message: string; next: string }) =>
    Response.json({ ...error, message: `${error.message} ${error.next}` }, { status })
  const server = Bun.serve({
    port: 0,
    fetch: async (request) => {
      const url = new URL(request.url)
      if (url.pathname.startsWith("/repos/") || url.pathname.startsWith("/repositories/")) {
        const authorization = request.headers.get("authorization")
        state.github.push({ path: url.pathname, authorization })
        const named = state.repositories.get(url.pathname.slice("/repos/".length))
        if (named && (named.visibility === "public" || authorization === "Bearer reader-token"))
          return Response.json(named)
        const id = Number(url.pathname.slice("/repositories/".length))
        if (state.readable.has(id) && authorization === "Bearer reader-token")
          return Response.json({ id, visibility: "private" })
        return Response.json({ message: "Not Found" }, { status: 404 })
      }
      // The list the reachable set is checked against, which the plugin keeps fresh on its own: not logged.
      if (url.pathname === "/api/memory/anchors") return Response.json({ anchors: state.anchors })
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
      if (url.pathname === "/api/memory/inject") return Response.json({ entries: state.injected })
      if (url.pathname === "/api/memory/entries" && request.method === "POST") {
        const key = String(body?.idempotencyKey)
        const saved = state.published.get(key)
        if (saved) return Response.json({ ...saved, nearest: [], replayed: true })
        const duplicate = state.duplicate
        if (duplicate && !(body?.distinctFrom as string[] | undefined)?.includes(duplicate.id))
          return refuse(409, {
            _tag: "MemoryDuplicate",
            candidates: [duplicate],
            next: `Patch ${duplicate.id} with expectedRevision 1 (edits, or append) to add what yours says. If yours is a genuinely different finding, publish again with distinctFrom: ["${duplicate.id}"].`,
            message: `Not published, nothing was written: "${duplicate.title}" already says this.`,
          })
        const created = { id: `mem_new${state.published.size}`, revision: 1 }
        state.published.set(key, created)
        return Response.json({ ...created, nearest: state.hits })
      }
      const retired = url.pathname.match(/^\/api\/memory\/entries\/([^/]+)\/retire$/)?.[1]
      if (retired && request.method === "POST") {
        const revision = (state.revisions.get(retired) ?? 1) + 1
        state.revisions.set(retired, revision)
        return Response.json({ id: retired, revision, nearest: [] })
      }
      const id = url.pathname.match(/^\/api\/memory\/entries\/([^/]+)$/)?.[1]
      if (id === "mem_missing") return Response.json({ _tag: "NotFound" }, { status: 404 })
      if (id === "mem_retired" && request.method === "GET")
        return Response.json(
          entry(id, {
            retired: { at: new Date(0).toISOString(), reason: "Deploys moved to the pipeline", supersededBy: "mem_2" },
          }),
        )
      if (id && request.method === "GET") return Response.json(entry(id))
      if (id && request.method === "PATCH") {
        const current = entry(id).body
        if (state.rebase)
          return Response.json({
            id,
            revision: 3,
            nearest: [],
            ...(body?.body === undefined ? {} : { merged: true }),
            rebasedFrom: 1,
            changesSince: "@@ -2 +2 @@\n-More\n+Less",
            diff: "--- body\n-Body of\n+Use bun for",
          })
        const revision = state.revisions.get(id) ?? 1
        if (body?.expectedRevision !== revision)
          return refuse(409, {
            _tag: "MemoryConflict",
            revision,
            changes: "@@ -2 +2 @@\n-More\n+Less",
            body: `Body of ${id}\nLess`,
            next: `Apply your change to the current body and patch again with expectedRevision ${revision}.`,
            message: `The entry changed since the revision you read (now ${revision}) and your change touches what changed, so nothing was written.`,
          })
        const edits = body?.edits as { oldText: string; newText: string }[] | undefined
        const missed = edits?.findIndex((edit) => current.split(edit.oldText).length !== 2) ?? -1
        if (edits && missed >= 0)
          return refuse(400, {
            _tag: "MemoryEditFailed",
            edit: missed,
            reason: "not-found",
            revision,
            candidates: [{ line: 1, text: `Body of ${id}`, similarity: 0.42 }],
            body: current,
            next: `Copy oldText exactly from body and patch again with expectedRevision ${revision}.`,
            message: `Edit ${missed + 1}: oldText isn't in revision ${revision}; nothing was written. The closest passages start on lines 1.`,
          })
        const changed =
          edits?.reduce((text, edit) => text.replace(edit.oldText, edit.newText), current) ??
          (typeof body?.append === "string" ? `${current}\n\n${body.append}` : (body?.body as string | undefined))
        state.revisions.set(id, revision + 1)
        return Response.json({
          id,
          revision: revision + 1,
          nearest: [],
          ...(changed === undefined ? {} : { diff: `--- body\n-${current}\n+${changed}` }),
          ...(edits && state.matched ? { matched: state.matched } : {}),
          ...(typeof body?.body === "string" && body.body.length < current.length / 2
            ? { warnings: ["The rewrite removed more than 30% of the body."] }
            : {}),
        })
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
  // Compactions the test ends, heard alongside the host's own events.
  const compactions = yield* Queue.unbounded<Session.ID>()
  const subscribe = ((input) =>
    input?.types?.some((type) => type === "session.compaction.ended")
      ? Stream.merge(
          real.event.subscribe(input),
          Stream.fromQueue(compactions).pipe(
            Stream.map((sessionID) => ({ type: "session.compaction.ended", data: { sessionID } }) as never),
          ),
        )
      : real.event.subscribe(input)) as PluginContext.Context["event"]["subscribe"]
  const host: PluginContext.Context = {
    ...real,
    event: { ...real.event, subscribe },
    session: {
      ...real.session,
      synthetic: (input) => {
        synthetic.push(input)
        return real.session.synthetic(input)
      },
    },
  }
  // GitHub is the fake Console too, asked with the reader's token.
  yield* OpencodePlugin.effect(host).pipe(
    Effect.provideService(OpencodeMemoryAccess.GitHub, {
      api: console.server.url.origin,
      env: { GH_TOKEN: "reader-token" },
    }),
  )
  // Lets the plugin's subscriber take the compaction before the test goes on.
  const compacted = (sessionID: Session.ID) =>
    Queue.offer(compactions, sessionID).pipe(Effect.andThen(Effect.yieldNow), Effect.andThen(Effect.yieldNow))
  return { host, synthetic, compacted }
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

const context = (sessionID: Session.ID, call = "call_1"): Tool.Context => ({
  sessionID,
  agent: Agent.ID.make("build"),
  messageID: SessionMessage.ID.create(),
  id: Tool.CallID.make(call),
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

/** A completed tool call, as the tool hooks report it. */
const ran = (sessionID: Session.ID, tool: string, input: unknown, output?: unknown) =>
  Effect.gen(function* () {
    const hooks = yield* PluginHooks.Service
    const event = {
      tool,
      sessionID,
      agent: Agent.ID.make("build"),
      messageID: SessionMessage.ID.create(),
      id: Tool.CallID.make("call_1"),
      input,
      status: "completed" as const,
      result: { output } as Tool.Result,
    }
    yield* hooks.trigger("tool", "execute.after", event)
    return event.result
  })

/** A tool result's text as the model gets it. */
const resultText = (result: Tool.Result) =>
  typeof result.content === "string"
    ? result.content
    : (result.content ?? []).map((part) => (part.type === "text" ? part.text : "")).join("")

const texts = (event: SessionHooks["context"]) =>
  event.messages.map((message) => message.content.map((part) => (part.type === "text" ? part.text : "")).join(""))

describe("OpencodePlugin memory", () => {
  it.effect("offers the memory tools while the Console advertises memory, and removes them when it stops", () =>
    withConsole((console) =>
      Effect.gen(function* () {
        yield* start(console)
        expect((yield* memoryTools).toSorted()).toEqual([
          "append",
          "edit",
          "publish",
          "read",
          "retire",
          "rewrite",
          "search",
        ])

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

  it.effect("searches with the files the session worked on and reads as the signed-in member", () =>
    withConsole((console) =>
      Effect.gen(function* () {
        const { host } = yield* start(console)
        const session = yield* host.session.create({})
        console.state.hits = [hit("mem_1", 0.4, "Connect\nfirst")]
        yield* ran(session.id, "read", { path: "apps/worker/deploy.ts" })

        const found = yield* (yield* memoryTool("search")).execute(
          { query: "deploy fails", kinds: ["bug"] },
          context(session.id),
        )
        expect(found.output).toEqual({ results: console.state.hits })
        expect(found.content).toBe("- mem_1 r1 bug: Entry mem_1 — Connect first")
        // The session's directory isn't a Git checkout, so there's no repository to send.
        expect(console.state.requests.at(-1)).toEqual({
          method: "POST",
          path: "/api/memory/search",
          body: {
            query: "deploy fails",
            context: { files: ["apps/worker/deploy.ts"] },
            kinds: ["bug"],
            sessionID: session.id,
          },
          authorization: "Bearer secret",
        })

        const read = yield* (yield* memoryTool("read")).execute({ id: "mem_1" }, context(session.id))
        expect(read.output).toMatchObject({ id: "mem_1", kind: "bug", revision: 1, body: "Body of mem_1\nMore" })
        expect(read.content).toBe(
          "mem_1 r1 bug · deploy · apps/worker/ · github.com/acme/app@main abc123 · ada@example.com 1970-01-01\nErrors: ERR_DEPLOY\n# Entry mem_1\n\nBody of mem_1\nMore",
        )
        expect(console.state.requests.at(-1)?.path).toBe(`/api/memory/entries/mem_1?sessionID=${session.id}`)

        const missing = yield* (yield* memoryTool("read"))
          .execute({ id: "mem_missing" }, context(session.id))
          .pipe(Effect.flip)
        expect(missing.message).toBe(
          "Not found, or not readable with your repository access (or memory is off for this OpenCode Console workspace); retrying won't change that",
        )
      }),
    ),
  )

  it.effect("publishes with the tool call's key, which only a retry of that call reuses, and passes on a refusal", () =>
    withConsole((console) =>
      Effect.gen(function* () {
        const { host } = yield* start(console)
        const session = yield* host.session.create({})
        const publish = yield* memoryTool("publish")

        const input = {
          kind: "gotcha",
          title: "Deploy needs the VPN",
          body: "Connect first",
          paths: ["apps/worker/"],
          errors: ["ECONNREFUSED"],
          tags: ["deploy"],
        }
        const published = yield* publish.execute(input, context(session.id, "call_publish"))
        expect(published.content).toBe("Published mem_new0 r1.")
        // The session's directory isn't a Git checkout, so the session is all the source there is.
        const sent = console.state.requests.at(-1)?.body as Record<string, unknown>
        expect(sent).toEqual({
          ...input,
          source: { sessionID: session.id },
          idempotencyKey: `${session.id}:call_publish`,
        })

        // The same call again, as after a lost answer, sends the same key and gets the entry the first one saved.
        const retried = yield* publish.execute(input, context(session.id, "call_publish"))
        expect(retried.content).toBe("Published mem_new0 r1 (this publish was already saved).")
        expect(console.state.published.size).toBe(1)

        // The agent re-issuing it is another call with its own key: Console's duplicate check answers that.
        console.state.duplicate = hit("mem_close", 0.95, "VPN first")
        const refused = yield* publish
          .execute({ kind: "gotcha", title: "VPN for deploys", body: "Connect it" }, context(session.id, "call_again"))
          .pipe(Effect.flip)
        expect((console.state.requests.at(-1)?.body as Record<string, unknown>).idempotencyKey).toBe(
          `${session.id}:call_again`,
        )
        expect(refused.message).toBe(
          [
            'Not published, nothing was written: "Entry mem_close" already says this.',
            "- mem_close r1 bug: Entry mem_close — VPN first",
            'Next: Patch mem_close with expectedRevision 1 (edits, or append) to add what yours says. If yours is a genuinely different finding, publish again with distinctFrom: ["mem_close"].',
          ].join("\n"),
        )
        const distinct = yield* publish.execute(
          { kind: "gotcha", title: "VPN for deploys", body: "Connect it", distinctFrom: ["mem_close"] },
          context(session.id, "call_distinct"),
        )
        expect(distinct.content).toBe("Published mem_new1 r1.")
      }),
    ),
  )

  it.effect("sends the restricted repositories the reader's own GitHub access reaches, by id only", () =>
    withConsole((console) =>
      Effect.gen(function* () {
        console.state.anchors = ["github.com/7", "github.com/8", "gitlab.example.com/9"]
        console.state.readable.add(7)
        const { host } = yield* start(console)
        const session = yield* host.session.create({})

        yield* (yield* memoryTool("search")).execute({ query: "deploy" }, context(session.id))
        expect(console.state.requests.at(-1)?.body).toMatchObject({ query: "deploy", reachable: ["github.com/7"] })
        // Only GitHub's ids were checked, each with the reader's token; another host's is left out unchecked.
        expect(new Set(console.state.github.map((request) => request.path))).toEqual(
          new Set(["/repositories/7", "/repositories/8"]),
        )
        expect(console.state.github.every((request) => request.authorization === "Bearer reader-token")).toBe(true)

        yield* (yield* memoryTool("read")).execute({ id: "mem_1" }, context(session.id))
        expect(console.state.requests.at(-1)?.path).toBe(
          `/api/memory/entries/mem_1?sessionID=${session.id}&reachable=github.com%2F7`,
        )
        yield* (yield* memoryTool("append")).execute({ id: "mem_1", revision: 1, text: "More" }, context(session.id))
        expect(console.state.requests.at(-1)?.body).toMatchObject({ append: "More", reachable: ["github.com/7"] })
      }),
    ),
  )

  it.effect("sends nothing that holds a secret, and this machine's paths relative to the checkout", () =>
    withConsole((console) =>
      Effect.gen(function* () {
        const { host } = yield* start(console)
        const session = yield* host.session.create({})
        const directory = (yield* Location.Service).directory
        const publish = yield* memoryTool("publish")

        const asked = console.state.requests.length
        const refused = yield* publish
          .execute(
            { kind: "procedure", title: "Reach the database", body: "Run `PGPASSWORD=hunter2 psql -h db app`." },
            context(session.id),
          )
          .pipe(Effect.flip)
        expect(refused.message).toBe(
          "Nothing was sent: body holds a password, secret or token assigned to a variable, which may not go into the workspace's shared memory. Replace it with a variable reference such as $TOKEN or a placeholder such as <password>, then call memory.publish again.",
        )
        expect(refused.message).not.toContain("hunter2")
        expect(console.state.requests.length).toBe(asked)

        const edit = yield* memoryTool("edit")
        const header = yield* edit
          .execute(
            {
              id: "mem_1",
              revision: 1,
              edits: [{ oldText: "More", newText: "curl -H 'Authorization: Bearer abc123'" }],
            },
            context(session.id),
          )
          .pipe(Effect.flip)
        expect(header.message).toStartWith(
          "Nothing was sent: edits[0].newText holds a credential in an Authorization header",
        )
        expect(header.message).toEndWith("then call memory.edit again.")
        expect(console.state.requests.length).toBe(asked)

        yield* publish.execute(
          {
            kind: "procedure",
            title: "Reach the database",
            body: `Run \`PGPASSWORD=$PGPASSWORD psql\` from ${directory}; the schema is ${path.join(directory, "db/schema.sql")}.`,
            paths: [path.join(directory, "db/")],
          },
          context(session.id),
        )
        expect(console.state.requests.at(-1)?.body).toMatchObject({
          body: "Run `PGPASSWORD=$PGPASSWORD psql` from .; the schema is db/schema.sql.",
          paths: ["db/"],
        })
      }),
    ),
  )

  it.effect("edits several places against the revision read, and passes on what Console says to fix a miss", () =>
    withConsole((console) =>
      Effect.gen(function* () {
        const { host } = yield* start(console)
        const session = yield* host.session.create({})
        const edit = yield* memoryTool("edit")

        const edited = yield* edit.execute(
          {
            id: "mem_1",
            revision: 1,
            oldText: "Body of",
            newText: "Use bun for",
            edits: [{ oldText: "More", newText: "" }],
          },
          context(session.id),
        )
        expect(edited.content).toBe("mem_1 is now r2.\n--- body\n-Body of mem_1\nMore\n+Use bun for mem_1\n")
        expect(console.state.requests.at(-1)).toEqual({
          method: "PATCH",
          path: "/api/memory/entries/mem_1",
          body: {
            expectedRevision: 1,
            edits: [
              { oldText: "Body of", newText: "Use bun for" },
              { oldText: "More", newText: "" },
            ],
            source: { sessionID: session.id },
          },
          authorization: "Bearer secret",
        })

        // Console's words, the closest passages, the current body, then its one next call, once and as written.
        const missed = yield* edit
          .execute({ id: "mem_1", revision: 1, oldText: "Moore", newText: "x" }, context(session.id))
          .pipe(Effect.flip)
        // Cited from r1, sent from r2: the session's own edit since isn't news to it.
        expect((console.state.requests.at(-1)?.body as { expectedRevision: number }).expectedRevision).toBe(2)
        expect(missed.message).toBe(
          [
            "Edit 1: oldText isn't in revision 2; nothing was written. The closest passages start on lines 1.",
            "Closest text, check it's your target: line 1 (42% similar)",
            "```text\nBody of mem_1\n```",
            "Current body (r2):",
            "```text\nBody of mem_1\nMore\n```",
            "Next: Copy oldText exactly from body and patch again with expectedRevision 2.",
          ].join("\n"),
        )
        const stale = yield* edit
          .execute({ id: "mem_1", revision: 0, oldText: "More", newText: "x" }, context(session.id))
          .pipe(Effect.flip)
        expect(stale.message).toBe(
          [
            "The entry changed since the revision you read (now 2) and your change touches what changed, so nothing was written.",
            "Changes since your revision:",
            "```text\n@@ -2 +2 @@\n-More\n+Less\n```",
            "Current body (r2):",
            "```text\nBody of mem_1\nLess\n```",
            "Next: Apply your change to the current body and patch again with expectedRevision 2.",
          ].join("\n"),
        )

        // A write applied over changes since its revision says what they were.
        console.state.rebase = true
        const rebased = yield* edit.execute(
          { id: "mem_1", revision: 1, oldText: "Body of", newText: "Use bun for" },
          context(session.id),
        )
        expect(rebased.content).toBe(
          "mem_1 is now r3 (applied over changes since r1).\nChanges since r1:\n@@ -2 +2 @@\n-More\n+Less\n--- body\n-Body of\n+Use bun for",
        )
        console.state.rebase = false

        // A fuzzy match is flagged, so the agent checks the diff.
        console.state.matched = ["fuzzy"]
        const fuzzy = yield* edit.execute(
          { id: "mem_1", revision: 1, oldText: "More", newText: "Less" },
          context(session.id),
        )
        expect(fuzzy.content).toContain("An oldText matched only approximately: check the diff.")

        // Cited from r1 again, sent from r3: r1 → r2 and r2 → r3 were this session's own writes.
        yield* edit.execute({ id: "mem_1", revision: 1, kind: "gotcha", title: "Bun, not npm" }, context(session.id))
        expect(console.state.requests.at(-1)?.body).toEqual({
          expectedRevision: 3,
          kind: "gotcha",
          title: "Bun, not npm",
          source: { sessionID: session.id },
        })
        const empty = yield* edit.execute({ id: "mem_1", revision: 1 }, context(session.id)).pipe(Effect.flip)
        expect(empty.message).toBe("edit takes oldText and newText, edits, or a new kind, title, tags, paths or errors")
      }),
    ),
  )

  it.effect("still conflicts when someone else wrote after the session's own write", () =>
    withConsole((console) =>
      Effect.gen(function* () {
        const { host } = yield* start(console)
        const session = yield* host.session.create({})
        const edit = yield* memoryTool("edit")
        yield* edit.execute({ id: "mem_1", revision: 1, oldText: "More", newText: "Less" }, context(session.id))
        console.state.revisions.set("mem_1", 3)
        const stale = yield* edit
          .execute({ id: "mem_1", revision: 1, oldText: "Body of", newText: "Use bun for" }, context(session.id))
          .pipe(Effect.flip)
        expect((console.state.requests.at(-1)?.body as { expectedRevision: number }).expectedRevision).toBe(2)
        expect(stale.message).toContain("now 3")
      }),
    ),
  )

  it.effect("takes other editors' names for an edit's texts", () =>
    Effect.gen(function* () {
      const hooks = yield* PluginHooks.Service
      return yield* withConsole((console) =>
        Effect.gen(function* () {
          const { host } = yield* start(console)
          const session = yield* host.session.create({})
          const event = yield* hooks.trigger("tool", "execute.before", {
            tool: "memory_edit",
            sessionID: session.id,
            agent: Agent.ID.make("build"),
            messageID: SessionMessage.ID.create(),
            id: Tool.CallID.make("call_1"),
            input: {
              id: "mem_1",
              revision: 1,
              old_string: "a",
              new_string: "b",
              edits: [{ old_str: "c", new_str: "d" }],
            },
          })
          expect(event.input).toEqual({
            id: "mem_1",
            revision: 1,
            oldText: "a",
            newText: "b",
            edits: [{ oldText: "c", newText: "d" }],
          })
        }),
      )
    }),
  )

  it.effect("appends new material, rewrites a whole body with Console's warnings, and retires an entry", () =>
    withConsole((console) =>
      Effect.gen(function* () {
        const { host } = yield* start(console)
        const session = yield* host.session.create({})
        yield* (yield* memoryTool("append")).execute(
          { id: "mem_1", revision: 1, text: "Also on CI." },
          context(session.id),
        )
        expect(console.state.requests.at(-1)?.body).toEqual({
          expectedRevision: 1,
          append: "Also on CI.",
          source: { sessionID: session.id },
        })

        // A rewrite replaces what the entry says: it starts from a revision the session was shown whole.
        const asked = console.state.requests.length
        const unread = yield* (yield* memoryTool("rewrite"))
          .execute({ id: "mem_1", revision: 1, body: "Short" }, context(session.id))
          .pipe(Effect.flip)
        expect(unread.message).toBe(
          'Nothing was sent: rewrite acts on the whole of mem_1, so it starts from text you were shown, and this session hasn\'t been shown r1 whole. Call memory.read with id "mem_1", then call memory.rewrite again with the revision it shows.',
        )
        expect(console.state.requests.length).toBe(asked)
        yield* (yield* memoryTool("read")).execute({ id: "mem_1" }, context(session.id))

        // The rewrite cites r1, which the session read; its own append since doesn't make it stale.
        const rewritten = yield* (yield* memoryTool("rewrite")).execute(
          { id: "mem_1", revision: 1, body: "Short" },
          context(session.id),
        )
        expect(console.state.requests.at(-1)?.body).toEqual({
          expectedRevision: 2,
          body: "Short",
          source: { sessionID: session.id },
        })
        expect(rewritten.content).toBe(
          "mem_1 is now r3.\nWarning: The rewrite removed more than 30% of the body.\n--- body\n-Body of mem_1\nMore\n+Short",
        )

        const retired = yield* (yield* memoryTool("retire")).execute(
          { id: "mem_1", revision: 1, reason: "Deploys moved to the pipeline", supersededBy: "mem_2" },
          context(session.id),
        )
        expect(retired.content).toBe("mem_1 is retired (r4); it's no longer searched or injected.")
        expect(console.state.requests.at(-1)).toEqual({
          method: "POST",
          path: "/api/memory/entries/mem_1/retire",
          body: { expectedRevision: 3, reason: "Deploys moved to the pipeline", supersededBy: "mem_2" },
          authorization: "Bearer secret",
        })
        const read = yield* (yield* memoryTool("read")).execute({ id: "mem_retired" }, context(session.id))
        expect(read.content).toContain("\nRetired 1970-01-01: Deploys moved to the pipeline (superseded by mem_2)\n")
      }),
    ),
  )

  it.effect("injects what Console returns for the first prompt, whole, into the request after it, once", () =>
    withConsole((console) =>
      Effect.gen(function* () {
        const { host, synthetic } = yield* start(console)
        const hooks = yield* PluginHooks.Service
        const session = yield* host.session.create({})
        console.state.injected = [injected("mem_a", 0.95), injected("mem_b", 0.7)]

        yield* prompt(session.id, "  Fix the deploy ")
        const first = request(session.id, "Fix the deploy")
        yield* hooks.trigger("session", "context", first)
        expect(console.state.requests).toEqual([
          {
            method: "POST",
            path: "/api/memory/inject",
            body: { sessionID: session.id, moment: "prompt", query: "Fix the deploy", context: {} },
            authorization: "Bearer secret",
          },
        ])
        const delivered = OpencodeMemoryPolicy.initial.render(console.state.injected, {
          type: "prompt",
          text: "Fix the deploy",
          files: [],
        })
        expect(delivered).toContain(
          "## mem_a r1 bug: Entry mem_a\nBody of mem_a\nMore\n## mem_b r1 bug: Entry mem_b\nBody of mem_b\nMore",
        )
        expect(delivered).toContain('<workspace-memory for="task">')
        expect(texts(first)).toEqual(["Fix the deploy", delivered])
        expect(synthetic).toMatchObject([
          {
            sessionID: session.id,
            text: delivered,
            description: "2 memory entries for this task",
            metadata: { source: "console.memory", moment: "prompt", entries: ["mem_a@1", "mem_b@1"] },
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

  it.effect("delivers injected entries once more after a compaction, and rewrites start from what's shown since", () =>
    withConsole((console) =>
      Effect.gen(function* () {
        const { host, synthetic, compacted } = yield* start(console)
        const hooks = yield* PluginHooks.Service
        const session = yield* host.session.create({})
        console.state.injected = [injected("mem_a", 0.95)]
        yield* prompt(session.id, "Fix the deploy")
        yield* hooks.trigger("session", "context", request(session.id, "Fix the deploy"))
        console.state.injected = [injected("mem_fix", 0.9)]
        yield* ran(session.id, "shell", { command: "bun test" }, { exitCode: 1, output: "TypeError: boom" })
        expect(synthetic).toHaveLength(1)

        yield* compacted(session.id)
        // The summary dropped what the agent was shown: a rewrite from it waits for the entry to be shown again.
        const rewrite = yield* memoryTool("rewrite")
        const stale = yield* rewrite
          .execute({ id: "mem_a", revision: 1, body: "Short" }, context(session.id))
          .pipe(Effect.flip)
        expect(stale.message).toContain("hasn't been shown r1 whole since the conversation was compacted.")

        const next = request(session.id, "Go on")
        yield* hooks.trigger("session", "context", next)
        const again = OpencodeMemoryPolicy.initial.render([injected("mem_a", 0.95), injected("mem_fix", 0.9)], {
          type: "prompt",
          text: "Fix the deploy",
          files: [],
        })
        expect(texts(next)).toEqual(["Go on", again])
        expect(synthetic.at(-1)).toMatchObject({
          text: again,
          description: "2 memory entries again after compaction",
          metadata: { source: "console.memory", moment: "compaction", entries: ["mem_a@1", "mem_fix@1"] },
          resume: false,
        })
        // Once: the request after it gets nothing more.
        const later = request(session.id, "Go on")
        yield* hooks.trigger("session", "context", later)
        expect(texts(later)).toEqual(["Go on"])
        yield* rewrite.execute({ id: "mem_a", revision: 1, body: "Short" }, context(session.id))
        expect(console.state.requests.at(-1)?.body).toMatchObject({ expectedRevision: 1, body: "Short" })
      }),
    ),
  )

  it.effect("reminds a session once, when it would go idle after a verified fix, that it may publish", () =>
    withConsole((console) =>
      Effect.gen(function* () {
        const { host, synthetic } = yield* start(console)
        const hooks = yield* PluginHooks.Service
        const idle = (sessionID: Session.ID, background: ReadonlyArray<{ sessionID: Session.ID }> = []) =>
          hooks.trigger("session", "experimental.idle", { sessionID, background } as never)
        const fix = (sessionID: Session.ID) =>
          Effect.gen(function* () {
            yield* ran(sessionID, "shell", { command: "bun test" }, { exitCode: 1, output: "(fail) dayKey\n 1 fail" })
            yield* ran(sessionID, "edit", { path: "src/dates.ts", oldString: "a", newString: "b" })
            yield* ran(sessionID, "shell", { command: "bun test" }, { exitCode: 0, output: " 2 pass\n 0 fail" })
          })

        // Nothing learned yet: no reminder.
        const session = yield* host.session.create({})
        yield* ran(session.id, "shell", { command: "bun test" }, { exitCode: 0, output: " 2 pass\n 0 fail" })
        yield* idle(session.id)
        expect(synthetic).toEqual([])

        yield* fix(session.id)
        // While its own shell still runs in the background, the session isn't done.
        yield* idle(session.id, [{ sessionID: session.id }])
        expect(synthetic).toEqual([])
        yield* idle(session.id)
        expect(synthetic).toMatchObject([
          {
            sessionID: session.id,
            text: OpencodeMemoryPolicy.initial.reminder("verified fix (tests that failed now pass)"),
            metadata: {
              source: "console.memory",
              kind: "publish-reminder",
              lesson: "verified fix (tests that failed now pass)",
            },
          },
        ])
        expect(synthetic[0]).not.toHaveProperty("resume")
        // Once per session.
        yield* fix(session.id)
        yield* idle(session.id)
        expect(synthetic).toHaveLength(1)

        // A subagent's session leaves publishing to its parent.
        const child = yield* host.session.create({ parentID: session.id })
        yield* fix(child.id)
        yield* idle(child.id)
        expect(synthetic).toHaveLength(1)

        // The publish tool's description is the template the reminder points at.
        const publish = yield* memoryTool("publish")
        expect(publish.description.split("\n")[0]).toStartWith("Most sessions should publish nothing.")
        expect(publish.description).toContain("\nClaim: ")
        expect(publish.description).toContain("\nVerify: the command to run and the result to expect. / Avoid: ")
      }),
    ),
  )

  it.effect("says a rewrite Console merged with the changes since it was read", () =>
    withConsole((console) =>
      Effect.gen(function* () {
        const { host } = yield* start(console)
        const session = yield* host.session.create({})
        yield* (yield* memoryTool("read")).execute({ id: "mem_1" }, context(session.id))
        console.state.rebase = true
        const merged = yield* (yield* memoryTool("rewrite")).execute(
          { id: "mem_1", revision: 1, body: "Use bun for tests\nLess" },
          context(session.id),
        )
        expect(resultText(merged).split("\n")[0]).toBe(
          "mem_1 is now r3 (merged word by word with the changes since r1: check the diff).",
        )
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

        console.state.injected = [{ id: "mem_bad" } as ReturnType<typeof injected>]
        const broken = yield* host.session.create({})
        yield* prompt(broken.id, "Fix the deploy")
        const failed = request(broken.id, "Fix the deploy")
        yield* hooks.trigger("session", "context", failed)
        expect(texts(failed)).toEqual(["Fix the deploy"])
        expect(synthetic).toEqual([])
      }),
    ),
  )

  it.effect("injects for a failing command with the task, its error and the files worked on, twice at most", () =>
    withConsole((console) =>
      Effect.gen(function* () {
        const { host, synthetic } = yield* start(console)
        const hooks = yield* PluginHooks.Service
        const directory = (yield* Location.Service).directory
        const session = yield* host.session.create({})
        yield* prompt(session.id, "Fix the deploy")
        yield* hooks.trigger("session", "context", request(session.id, "Fix the deploy"))
        console.state.injected = [injected("mem_fix", 0.9)]
        yield* ran(session.id, "read", { path: path.join(directory, "src/deploy.ts") })
        yield* ran(session.id, "patch", {
          patchText: "*** Begin Patch\n*** Update File: src/config.ts\n@@\n*** End Patch",
        })
        yield* ran(session.id, "edit", { path: "src/deploy.ts", oldString: "a", newString: "b" })

        // A success, and a command that printed nothing, aren't failures worth a lookup.
        yield* ran(session.id, "shell", { command: "bun test" }, { exitCode: 0, output: "ok" })
        yield* ran(session.id, "shell", { command: "test -f x" }, { exitCode: 1, output: "" })
        const output = `${"x".repeat(3000)}\nTypeError: boom`
        // Piped through tail, the failing test run exits 0; its output still says it failed.
        const failed = yield* ran(session.id, "shell", { command: "bun test 2>&1 | tail -40" }, { exitCode: 0, output })
        const after = request(session.id, "Fix the deploy")
        yield* hooks.trigger("session", "context", after)
        expect(console.state.requests.at(-1)?.body).toEqual({
          sessionID: session.id,
          moment: "failure",
          query: "Fix the deploy",
          context: {
            files: ["src/config.ts", "src/deploy.ts"],
            errors: [output.slice(-2000)],
            commands: ["bun test 2>&1 | tail -40"],
          },
        })
        // Delivered in the command's own result, after what it printed; no message of its own.
        expect(resultText(failed)).toStartWith(JSON.stringify({ exitCode: 0, output }))
        expect(resultText(failed)).toContain('<workspace-memory for="failure">\n')
        expect(resultText(failed)).toContain("## mem_fix r1 bug: Entry mem_fix")
        expect(failed.metadata).toEqual({
          memory: { source: "console.memory", moment: "failure", entries: ["mem_fix@1"] },
        })
        expect(texts(after)).toEqual(["Fix the deploy"])
        expect(synthetic).toEqual([])

        yield* ran(session.id, "shell", { command: "bun test" }, { exitCode: 1, output: "TypeError: again" })
        yield* hooks.trigger("session", "context", request(session.id, "Fix the deploy"))
        yield* ran(session.id, "shell", { command: "bun test" }, { exitCode: 1, output: "TypeError: third" })
        yield* hooks.trigger("session", "context", request(session.id, "Fix the deploy"))
        expect(console.state.requests.map((item) => (item.body as { moment: string }).moment)).toEqual([
          "prompt",
          "failure",
          "failure",
        ])
      }),
    ),
  )

  it.effect("points out a given entry when the user's message corrects it, with the revision to edit", () =>
    withConsole((console) =>
      Effect.gen(function* () {
        const { host, synthetic } = yield* start(console)
        const hooks = yield* PluginHooks.Service
        const session = yield* host.session.create({})
        console.state.injected = [injected("mem_deploy", 0.9)]
        yield* prompt(session.id, "Deploy the worker")
        yield* hooks.trigger("session", "context", request(session.id, "Deploy the worker"))

        // Not a correction: no nudge.
        yield* prompt(session.id, "Thanks, go ahead with mem_deploy body")
        const plain = request(session.id, "Thanks")
        yield* hooks.trigger("session", "context", plain)
        expect(texts(plain)).toEqual(["Thanks"])

        // The injected entry's body reads "Body of mem_deploy"; the user says otherwise.
        yield* prompt(session.id, "No, that body of mem_deploy is wrong, deploy with wrangler instead")
        const corrected = request(session.id, "No, ...")
        yield* hooks.trigger("session", "context", corrected)
        const nudge = OpencodeMemoryPolicy.initial.nudge({
          id: "mem_deploy",
          revision: 1,
          title: "Entry mem_deploy",
          text: "",
        })
        expect(texts(corrected).at(-1)).toBe(nudge)
        expect(nudge).toContain("mem_deploy r1")
        expect(synthetic.at(-1)).toMatchObject({
          text: nudge,
          metadata: { source: "console.memory", kind: "correction", entry: "mem_deploy", revision: 1 },
          resume: false,
        })

        // After the agent's edit, a later nudge names the new revision; the request after it gets nothing more.
        yield* (yield* memoryTool("edit")).execute(
          { id: "mem_deploy", revision: 1, oldText: "More", newText: "wrangler deploy" },
          context(session.id),
        )
        yield* prompt(session.id, "Actually the body of mem_deploy should say wrangler, not npm")
        const again = request(session.id, "Actually ...")
        yield* hooks.trigger("session", "context", again)
        expect(texts(again).at(-1)).toContain("mem_deploy r2")
        const after = request(session.id, "Actually ...")
        yield* hooks.trigger("session", "context", after)
        expect(texts(after)).toEqual(["Actually ..."])
      }),
    ),
  )

  it.effect("doesn't inject a revision the session already read, but does inject its correction", () =>
    withConsole((console) =>
      Effect.gen(function* () {
        const { host, synthetic } = yield* start(console)
        const hooks = yield* PluginHooks.Service
        const session = yield* host.session.create({})
        yield* (yield* memoryTool("read")).execute({ id: "mem_seen" }, context(session.id))
        console.state.injected = [injected("mem_seen", 0.9)]
        const seen = yield* ran(
          session.id,
          "shell",
          { command: "bun test" },
          { exitCode: 1, output: "TypeError: boom" },
        )
        expect(seen).toEqual({ output: { exitCode: 1, output: "TypeError: boom" } })
        const event = request(session.id, "Fix it")
        yield* hooks.trigger("session", "context", event)
        expect(texts(event)).toEqual(["Fix it"])
        expect(synthetic).toEqual([])

        // Someone corrected it since: Console injects the new revision once, and so does the plugin.
        console.state.injected = [injected("mem_seen", 0.9, 2)]
        const corrected = yield* ran(
          session.id,
          "shell",
          { command: "bun test" },
          { exitCode: 1, output: "TypeError: again" },
        )
        expect(resultText(corrected)).toContain("## mem_seen r2 bug: Entry mem_seen")
      }),
    ),
  )

  it.effect(
    "records the checkout's repository, branch and commit with what it publishes, without the remote's token",
    () =>
      withConsole((console) =>
        Effect.gen(function* () {
          const directory = (yield* Location.Service).directory
          yield* Effect.promise(async () => {
            await initGit(directory, "-b", "trunk")
            await fs.appendFile(
              path.join(directory, ".git", "config"),
              '[remote "origin"]\n\turl = https://bot:ghp_secret@GitHub.com/Acme/App.git\n',
            )
            await $`git commit --allow-empty -m root`.cwd(directory).quiet()
          })
          const { host } = yield* start(console)
          const session = yield* host.session.create({})
          const publish = yield* memoryTool("publish")

          // Not found anonymously nor with the reader's token: who may read it can't be recorded.
          const asked = console.state.requests.length
          const unknown = yield* publish
            .execute({ kind: "decision", title: "Decision", body: "Why" }, context(session.id))
            .pipe(Effect.flip)
          expect(unknown.message).toStartWith("Nothing was sent: this machine couldn't look up Acme/App on GitHub")
          expect(console.state.requests.length).toBe(asked)

          console.state.repositories.set("Acme/App", { id: 4242, visibility: "private" })
          yield* publish.execute({ kind: "decision", title: "Decision", body: "Why" }, context(session.id))
          const sent = console.state.requests.at(-1)?.body as { source: Record<string, string>; anchor: unknown }
          expect(sent.source).toEqual({
            repo: "https://github.com/Acme/App",
            branch: "trunk",
            commitSha: expect.stringMatching(/^[0-9a-f]{40}$/),
            sessionID: session.id,
          })
          expect(sent.anchor).toEqual({ host: "github.com", name: "Acme/App", repoId: 4242, visibility: "private" })
          // Asked anonymously first, then with the reader's token; the remote's own token is never sent anywhere.
          expect(console.state.github.slice(-2)).toEqual([
            { path: "/repos/Acme/App", authorization: null },
            { path: "/repos/Acme/App", authorization: "Bearer reader-token" },
          ])
          expect(JSON.stringify([console.state.requests, console.state.github])).not.toContain("ghp_secret")
        }),
      ),
  )
})

describe("OpencodeMemoryPolicy.initial", () => {
  const session = (overrides: Record<string, unknown> = {}) =>
    ({ time: { created: 0, updated: 0 }, ...overrides }) as unknown as Session.Info
  const signals = (overrides: Partial<OpencodeMemoryPolicy.Signals> = {}): OpencodeMemoryPolicy.Signals => ({
    files: [],
    injected: { prompt: 0, failure: 0 },
    ...overrides,
  })
  const task = (text: string, files: string[] = []) => ({ type: "prompt" as const, text, files })

  test("injects for a new session's first prompt only, with its repository and the files attached to it", () => {
    const inject = OpencodeMemoryPolicy.initial.inject
    expect(inject(task("  Fix the deploy  "), signals(), session())).toEqual({ query: "Fix the deploy", context: {} })
    expect(inject(task("Fix it", ["src/a.ts"]), signals({ repo: "github.com/acme/app" }), session())).toEqual({
      query: "Fix it",
      context: { repo: "github.com/acme/app", files: ["src/a.ts"] },
    })
    // Paths the task names count as its files; versions, URLs and sentences' full stops don't.
    expect(
      inject(
        task(
          "Add discount() to src/pricing.ts, test it in `test/pricing.test.ts` and apps/api/. Bump to 1.2, see https://x.io/a.md or README.md.",
        ),
        signals(),
        session(),
      )?.context,
    ).toEqual({ files: ["src/pricing.ts", "test/pricing.test.ts", "apps/api/", "README.md"] })
    expect(inject(task("   "), signals(), session())).toBeUndefined()
    expect(
      inject(task("Keep going"), signals(), session({ time: { created: 0, updated: 0, busy: 1 } })),
    ).toBeUndefined()
    expect(inject(task("Fix the deploy"), signals(), session({ fork: { sessionID: "ses_parent" } }))).toBeUndefined()
  })

  test("injects for a failing command with the task as query, until the session had two such injections", () => {
    const failure = { type: "failure" as const, command: "bun test", output: "TypeError: boom", exitCode: 1 }
    const files = Array.from({ length: 25 }, (_, index) => `f${index}.ts`)
    expect(OpencodeMemoryPolicy.initial.inject(failure, signals({ files, task: "Fix it" }), session())).toEqual({
      query: "Fix it",
      context: { files: files.slice(-20), errors: ["TypeError: boom"], commands: ["bun test"] },
    })
    expect(OpencodeMemoryPolicy.initial.inject(failure, signals(), session())?.query).toBe("bun test")
    expect(
      OpencodeMemoryPolicy.initial.inject(failure, signals({ injected: { prompt: 1, failure: 2 } }), session()),
    ).toBeUndefined()
  })

  test("finds a verified fix or a dead end worked past in a session's test runs and edits", () => {
    const lesson = OpencodeMemoryPolicy.initial.lesson
    const work = (lastEdit: number, ...tests: Array<[number, boolean]>) => ({
      step: 10,
      lastEdit,
      tests: tests.map(([step, failed]) => ({ step, failed })),
    })
    expect(lesson(work(3, [1, true], [5, false]))).toBe("verified fix (tests that failed now pass)")
    expect(lesson(work(8, [1, true], [2, true], [9, false]))).toBe("verified fix (tests that failed now pass)")
    // Failing runs, all after the last edit, then a passing one: worked past without a change, a dead end.
    expect(lesson(work(-1, [1, true], [2, true], [3, false]))).toBe(
      "dead end you worked past (several failing attempts before a passing run)",
    )
    // Passing without a failure first, one failure without an edit before it, or no pass after the last edit: nothing.
    expect(lesson(work(3, [5, false]))).toBeUndefined()
    expect(lesson(work(-1, [1, true], [2, false]))).toBeUndefined()
    expect(lesson(work(6, [1, true], [5, false]))).toBeUndefined()
    expect(OpencodeMemoryPolicy.initial.test("ACME_DB_URL=memory://test bun test 2>&1 | tail -20")).toBe(true)
    expect(OpencodeMemoryPolicy.initial.test("uv run pytest -x tests/test_x.py")).toBe(true)
    expect(OpencodeMemoryPolicy.initial.test("git status && ls src")).toBe(false)
    expect(OpencodeMemoryPolicy.initial.reminder("verified fix (tests that failed now pass)")).toStartWith(
      "This session had a verified fix (tests that failed now pass). If it taught something",
    )
  })

  test("counts a command as failed by its exit code, or by its output when a pipe hides the exit code", () => {
    const failed = OpencodeMemoryPolicy.initial.failed
    expect(failed("bun test", "error: x\n 1 fail", 1)).toBe(true)
    expect(failed("test -f x", "", 1)).toBe(false)
    expect(failed("bun test 2>&1 | tail -20", "error: ACME_DB_URL is not set\n 1 pass\n 1 fail", 0)).toBe(true)
    expect(failed("pytest | tail", "Traceback (most recent call last):\n  ...", 0)).toBe(true)
    expect(failed("bun test 2>&1 | tail -5", " 4 pass\n 0 fail", 0)).toBe(false)
    // A later command after `;` hides the exit code as a pipe does.
    expect(failed('bun test 2>&1; echo "exit=$?"', "(fail) config reads the database URL\n 1 fail\nexit=1", 0)).toBe(
      true,
    )
    expect(failed("cd app; bun test", " 3 pass\n 0 fail", 0)).toBe(false)
    // Unpiped, a zero exit is a success whatever it prints, as a search for errors is.
    expect(failed("grep -rn error: src", "src/a.ts:1: error: x", 0)).toBe(false)
    expect(failed("make || echo done", "Error: x", 0)).toBe(false)
  })

  test("reads a message as a correction only with correcting words and two shared terms", () => {
    const given = [
      { id: "mem_a", revision: 3, title: "Deploys use wrangler", text: "Run wrangler deploy from apps/worker." },
      { id: "mem_b", revision: 1, title: "Tests", text: "Run bun test in packages/core." },
    ]
    const correction = OpencodeMemoryPolicy.initial.correction
    expect(correction("Don't use wrangler deploy, use the pipeline", given)?.id).toBe("mem_a")
    expect(correction("Run wrangler deploy now", given)).toBeUndefined()
    expect(correction("No, that's wrong", given)).toBeUndefined()
    expect(correction("Actually run tests in packages/core with vitest", given)?.id).toBe("mem_b")
  })
})

describe("OpencodeMemory.repoName", () => {
  test("names a remote the same way for its SSH and HTTPS forms, without credentials", () => {
    expect(OpencodeMemory.repoName("git@github.com:anomalyco/opencode.git")).toBe("github.com/anomalyco/opencode")
    expect(OpencodeMemory.repoName("https://github.com/anomalyco/opencode")).toBe("github.com/anomalyco/opencode")
    expect(OpencodeMemory.repoName("https://x-access-token:tok@GitHub.com/anomalyco/opencode.git/")).toBe(
      "github.com/anomalyco/opencode",
    )
    expect(OpencodeMemory.repoName("ssh://git@gitlab.example.com:2222/group/sub/app.git")).toBe(
      "gitlab.example.com/group/sub/app",
    )
    expect(OpencodeMemory.repoName("/srv/git/app.git")).toBeUndefined()
    expect(OpencodeMemory.repoName("file:///srv/git/app.git")).toBeUndefined()
  })
})
