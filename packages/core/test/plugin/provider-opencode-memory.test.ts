import { describe, expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { $ } from "bun"
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
import { Location } from "@opencode/core/location"
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
const entry = (id: string, overrides: Record<string, unknown> = {}) => ({
  id,
  title: `Entry ${id}`,
  body: `Body of ${id}\nMore`,
  tags: ["fix"],
  source: { repo: "github.com/acme/app", branch: "main", commitSha: "abc123" },
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
        const edits = body?.edits as { oldText: string; newText: string }[] | undefined
        if (!edits) return Response.json(entry(id, { ...body, revision: 2 }))
        // Each oldText must occur exactly once in the body, as the edit operation Console is adding requires.
        const edited = edits.reduce<string | undefined>(
          (text, edit) =>
            text !== undefined && text.split(edit.oldText).length === 2
              ? text.replace(edit.oldText, edit.newText)
              : undefined,
          entry(id).body,
        )
        if (edited === undefined)
          return Response.json({ _tag: "MemoryInvalid", message: "oldText must occur exactly once" }, { status: 400 })
        return Response.json(entry(id, { body: edited, revision: 2 }))
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

/** A completed tool call, as the tool hooks report it. */
const ran = (sessionID: Session.ID, tool: string, input: unknown, output?: unknown) =>
  Effect.gen(function* () {
    const hooks = yield* PluginHooks.Service
    yield* hooks.trigger("tool", "execute.after", {
      tool,
      sessionID,
      agent: Agent.ID.make("build"),
      messageID: SessionMessage.ID.create(),
      id: Tool.CallID.make("call_1"),
      input,
      status: "completed",
      result: { output },
    })
  })

const texts = (event: SessionHooks["context"]) =>
  event.messages.map((message) => message.content.map((part) => (part.type === "text" ? part.text : "")).join(""))

describe("OpencodePlugin memory", () => {
  it.effect("offers the memory tools while the Console advertises memory, and removes them when it stops", () =>
    withConsole((console) =>
      Effect.gen(function* () {
        yield* start(console)
        expect((yield* memoryTools).toSorted()).toEqual(["edit", "publish", "read", "search", "update"])

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
          results: [
            {
              id: "mem_1",
              title: "Entry mem_1",
              snippet: "Connect\nfirst",
              revision: 1,
              score: 0.4,
              repo: "github.com/acme/app",
            },
          ],
        })
        expect(found.content).toBe("- mem_1 r1: Entry mem_1 — Connect first (github.com/acme/app)")
        expect(console.state.requests.at(-1)).toEqual({
          method: "POST",
          path: "/api/memory/search",
          body: { query: "deploy fails", sessionID: session.id },
          authorization: "Bearer secret",
        })

        const read = yield* (yield* memoryTool("read")).execute({ id: "mem_1" }, context(session.id))
        expect(read.output).toMatchObject({ id: "mem_1", revision: 1, body: "Body of mem_1\nMore" })
        expect(read.content).toBe(
          `mem_1 r1 · fix · github.com/acme/app@main abc123 · ada@example.com 1970-01-01\n# Entry mem_1\n\nBody of mem_1\nMore`,
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
          nearest: [
            {
              id: "mem_close",
              title: "Entry mem_close",
              snippet: "VPN first",
              revision: 1,
              score: 0.9,
              repo: "github.com/acme/app",
            },
          ],
        })
        expect(held.content).toContain("- mem_close r1: Entry mem_close — VPN first")
        expect(console.state.requests).toEqual([
          {
            method: "POST",
            path: "/api/memory/entries",
            body: { title: "Deploy VPN", body: "Use the VPN", source: { sessionID: session.id }, dryRun: true },
            authorization: "Bearer secret",
          },
        ])

        const published = yield* publish.execute(
          { title: "Deploy VPN", body: "Use the VPN", tags: ["gotcha"], distinct: true },
          context(session.id),
        )
        expect(published.output).toMatchObject({ entry: { id: "mem_new", title: "Deploy VPN", revision: 1 } })
        expect(published.content).toBe("Published mem_new r1.")
        // The session's directory isn't a Git checkout, so the session is all the source there is.
        expect(console.state.requests.at(-1)?.body).toEqual({
          title: "Deploy VPN",
          body: "Use the VPN",
          tags: ["gotcha"],
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
        expect(published.content).toBe("Published mem_new r1.")
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
        expect(updated.output).toEqual({ id: "mem_1", title: "Entry mem_1", revision: 2 })
        expect(updated.content).toBe("mem_1 is now r2.")
        expect(console.state.requests.at(-1)).toMatchObject({
          method: "PATCH",
          path: "/api/memory/entries/mem_1",
          body: { expectedRevision: 1, body: "Corrected", source: { sessionID: session.id } },
        })

        const stale = yield* update
          .execute({ id: "mem_1", revision: 0, body: "Corrected" }, context(session.id))
          .pipe(Effect.flip)
        expect(stale.message).toBe(
          "The entry changed since you read it; it is at revision 2 now. Read it again and retry your change on that revision.",
        )
        const empty = yield* update.execute({ id: "mem_1", revision: 1 }, context(session.id)).pipe(Effect.flip)
        expect(empty.message).toBe("update takes a new title, body, tags or several")
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
        const delivered = OpencodeMemoryPolicy.initial.render(
          [
            {
              id: "mem_a",
              title: "Entry mem_a",
              snippet: "Body of mem_a",
              revision: 1,
              score: 0.95,
              repo: "github.com/acme/app",
            },
            {
              id: "mem_b",
              title: "Entry mem_b",
              snippet: "Body of mem_b",
              revision: 1,
              score: 0.7,
              repo: "github.com/acme/app",
            },
          ],
          { type: "prompt", text: "Fix the deploy", files: [] },
        )
        expect(delivered).toContain(
          "- mem_a r1: Entry mem_a — Body of mem_a (github.com/acme/app)\n- mem_b r1: Entry mem_b — Body of mem_b (github.com/acme/app)",
        )
        expect(delivered).toContain('<workspace-memory for="task">')
        expect(texts(first)).toEqual(["Fix the deploy", delivered])
        expect(synthetic).toMatchObject([
          {
            sessionID: session.id,
            text: delivered,
            description: "2 memory entries for this task",
            metadata: { source: "console.memory", moment: "prompt", entries: ["mem_a", "mem_b"] },
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

  it.effect("injects for a failing command, with its error and the files the agent worked on, twice at most", () =>
    withConsole((console) =>
      Effect.gen(function* () {
        const { host, synthetic } = yield* start(console)
        const hooks = yield* PluginHooks.Service
        const directory = (yield* Location.Service).directory
        const session = yield* host.session.create({})
        console.state.hits = [hit("mem_fix", 0.9)]
        yield* ran(session.id, "read", { path: path.join(directory, "src/deploy.ts") })
        yield* ran(session.id, "patch", {
          patchText: "*** Begin Patch\n*** Update File: src/config.ts\n@@\n*** End Patch",
        })
        yield* ran(session.id, "edit", { path: "src/deploy.ts", oldString: "a", newString: "b" })

        // A success, and a command that printed nothing, aren't failures worth a lookup.
        yield* ran(session.id, "shell", { command: "bun test" }, { exitCode: 0, output: "ok" })
        yield* ran(session.id, "shell", { command: "test -f x" }, { exitCode: 1, output: "" })
        yield* ran(
          session.id,
          "shell",
          { command: "bun test" },
          { exitCode: 1, output: `${"x".repeat(2000)}\nTypeError: boom` },
        )
        const after = request(session.id, "Fix the deploy")
        yield* hooks.trigger("session", "context", after)
        const query = (console.state.requests[0]?.body as { query: string }).query
        expect(query.startsWith("$ bun test\n")).toBe(true)
        expect(query.endsWith("TypeError: boom\nFiles: src/config.ts src/deploy.ts")).toBe(true)
        expect(query.length).toBe(1000)
        expect(texts(after).at(-1)).toContain('<workspace-memory for="failure">')
        expect(synthetic.map((item) => item.description)).toEqual(["1 memory entry for this failure"])

        yield* ran(session.id, "shell", { command: "bun test" }, { exitCode: 1, output: "TypeError: again" })
        yield* hooks.trigger("session", "context", request(session.id, "Fix the deploy"))
        yield* ran(session.id, "shell", { command: "bun test" }, { exitCode: 1, output: "TypeError: third" })
        yield* hooks.trigger("session", "context", request(session.id, "Fix the deploy"))
        expect(console.state.requests.map((item) => item.path)).toEqual(["/api/memory/inject", "/api/memory/inject"])
      }),
    ),
  )

  it.effect("edits by sending only the changed text against the revision read", () =>
    withConsole((console) =>
      Effect.gen(function* () {
        const { host } = yield* start(console)
        const session = yield* host.session.create({})
        const edit = yield* memoryTool("edit")

        const edited = yield* edit.execute(
          { id: "mem_1", revision: 1, edits: [{ oldText: "More", newText: "Use bun, not npm" }] },
          context(session.id),
        )
        expect(edited.output).toEqual({ id: "mem_1", title: "Entry mem_1", revision: 2 })
        expect(edited.content).toBe("mem_1 is now r2.")
        expect(console.state.requests.at(-1)).toEqual({
          method: "PATCH",
          path: "/api/memory/entries/mem_1",
          body: {
            expectedRevision: 1,
            edits: [{ oldText: "More", newText: "Use bun, not npm" }],
            source: { sessionID: session.id },
          },
          authorization: "Bearer secret",
        })

        const ambiguous = yield* edit
          .execute({ id: "mem_1", revision: 1, edits: [{ oldText: "o", newText: "x" }] }, context(session.id))
          .pipe(Effect.flip)
        expect(ambiguous.message).toBe("oldText must occur exactly once")
      }),
    ),
  )

  it.effect("points out a given entry when the user's message corrects it, with the revision to edit", () =>
    withConsole((console) =>
      Effect.gen(function* () {
        const { host, synthetic } = yield* start(console)
        const hooks = yield* PluginHooks.Service
        const session = yield* host.session.create({})
        console.state.hits = [hit("mem_deploy", 0.9)]
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
          { id: "mem_deploy", revision: 1, edits: [{ oldText: "More", newText: "wrangler deploy" }] },
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

  it.effect("doesn't inject an entry the session already read", () =>
    withConsole((console) =>
      Effect.gen(function* () {
        const { host, synthetic } = yield* start(console)
        const hooks = yield* PluginHooks.Service
        const session = yield* host.session.create({})
        yield* (yield* memoryTool("read")).execute({ id: "mem_seen" }, context(session.id))
        console.state.hits = [hit("mem_seen", 0.9)]
        yield* ran(session.id, "shell", { command: "bun test" }, { exitCode: 1, output: "TypeError: boom" })
        const event = request(session.id, "Fix it")
        yield* hooks.trigger("session", "context", event)
        expect(texts(event)).toEqual(["Fix it"])
        expect(synthetic).toEqual([])
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
          yield* (yield* memoryTool("publish")).execute(
            { title: "Decision", body: "Why", distinct: true },
            context(session.id),
          )
          const source = (console.state.requests.at(-1)?.body as { source: Record<string, string> }).source
          expect(source).toEqual({
            repo: "github.com/Acme/App",
            branch: "trunk",
            commitSha: expect.stringMatching(/^[0-9a-f]{40}$/),
            sessionID: session.id,
          })
          expect(JSON.stringify(console.state.requests)).not.toContain("ghp_secret")
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

  test("injects for a new session's first prompt only, with the files attached to it", () => {
    const inject = OpencodeMemoryPolicy.initial.inject
    expect(inject(task("  Fix the deploy  "), signals(), session())).toEqual({ query: "Fix the deploy" })
    expect(inject(task("Fix it", ["src/a.ts"]), signals(), session())).toEqual({ query: "Fix it\nFiles: src/a.ts" })
    expect(inject(task("   "), signals(), session())).toBeUndefined()
    expect(
      inject(task("Keep going"), signals(), session({ time: { created: 0, updated: 0, busy: 1 } })),
    ).toBeUndefined()
    expect(inject(task("Fix the deploy"), signals(), session({ fork: { sessionID: "ses_parent" } }))).toBeUndefined()
  })

  test("injects for a failing command until the session had two such injections", () => {
    const failure = { type: "failure" as const, command: "bun test", output: "TypeError: boom", exitCode: 1 }
    const files = Array.from({ length: 7 }, (_, index) => `f${index}.ts`)
    expect(OpencodeMemoryPolicy.initial.inject(failure, signals({ files }), session())).toEqual({
      query: "$ bun test\nTypeError: boom\nFiles: f2.ts f3.ts f4.ts f5.ts f6.ts",
    })
    expect(
      OpencodeMemoryPolicy.initial.inject(failure, signals({ injected: { prompt: 1, failure: 2 } }), session()),
    ).toBeUndefined()
  })
})

describe("OpencodeMemoryPolicy.initial delivery", () => {
  const entry = (id: string, length: number): OpencodeMemoryPolicy.Hit => ({
    id,
    title: `Title ${id}`,
    snippet: "x".repeat(length),
    revision: 1,
    score: 0.9,
  })
  const task = { type: "prompt" as const, text: "t", files: [] }

  test("keeps injected lines within the budget, the best entry always", () => {
    const lines = (hits: OpencodeMemoryPolicy.Hit[]) =>
      OpencodeMemoryPolicy.initial
        .render(hits, task)
        .split("\n")
        .filter((line) => line.startsWith("- "))
    expect(lines([entry("a", 500), entry("b", 500), entry("c", 500)]).map((line) => line.slice(2, 3))).toEqual([
      "a",
      "b",
      "c",
    ])
    const kept = lines(Array.from({ length: 20 }, (_, index) => entry(`e${index}`, 120)))
    expect(kept.length).toBeLessThan(20)
    expect(kept.join("\n").length).toBeLessThanOrEqual(1200)
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
