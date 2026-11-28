import { describe, expect } from "bun:test"
import fs from "node:fs/promises"
import path from "node:path"
import { InMemoryTransport } from "@modelcontextprotocol/client"
import { Session } from "@opencode/core/session"
import { Skill } from "@opencode/core/skill"
import { Effect, Fiber, Layer } from "effect"
import { tmpdirScoped } from "../fixture/tmpdir"
import { testEffect } from "../lib/effect"
import { serve } from "./fixture/http"
import { ELICITATION_URL, LOGO, README, make } from "./fixture/server"
import { DIRECTORIES, remote, stdio, until, world, type Place } from "./harness"

const it = testEffect(Layer.empty)

// Every way to reach a configured server, with what it must offer. A path that loses a feature fails here, and one
// that gains it has to say so in this table.
const paths = [
  { transport: "http", era: "modern", pool: false, shared: false, events: true },
  { transport: "http", era: "modern", pool: true, shared: true, events: true },
  { transport: "http", era: "legacy", pool: false, shared: false, events: false },
  // A legacy server is never shared: each Location falls back to its own connection.
  { transport: "http", era: "legacy", pool: true, shared: false, events: false },
  { transport: "stdio", era: "modern", pool: false, shared: false, events: false },
  { transport: "stdio", era: "modern", pool: true, shared: true, events: false },
  { transport: "stdio", era: "legacy", pool: false, shared: false, events: false },
] as const

const SESSION = Session.ID.make("ses_contract")

describe("MCP capability contract", () => {
  for (const row of paths)
    it.live(`${row.transport} ${row.era} ${row.pool ? "pooled" : "direct"}`, () =>
      Effect.gen(function* () {
        const server = yield* fixture(row)
        const places = yield* world
        // Two Locations in different directories configure the same server.
        const a = yield* places.open({ directory: DIRECTORIES[0], servers: { fixture: server.config } })
        expect(yield* a.settled("fixture")).toEqual({ status: "connected" })
        const b = yield* places.open({ directory: DIRECTORIES[1], servers: { fixture: server.config } })
        expect(yield* b.settled("fixture")).toEqual({ status: "connected" })
        expect((yield* a.mcp.servers())[0]?.title).toBe("Fixture")
        expect(yield* server.connections).toBe(row.shared ? 1 : 2)

        yield* tools(a, b)

        expect((yield* a.mcp.prompts()).map((prompt) => prompt.name)).toEqual(["greet"])
        expect((yield* b.mcp.prompt({ server: "fixture", name: "greet", args: { name: "bob" } }))?.messages).toEqual([
          { role: "user", content: { type: "text", text: "hi bob" } },
        ])
        for (const place of [a, b]) yield* until("the prompt command", place.commands.get("fixture:greet"), Boolean)

        const catalog = yield* a.mcp.resourceCatalog()
        expect(catalog.resources.map((resource) => [resource.server, resource.uri])).toEqual([["fixture", README.uri]])
        expect(catalog.templates.map((template) => template.uriTemplate)).toContain("docs://{path}")
        expect(yield* b.mcp.readResource({ server: "fixture", uri: README.uri })).toEqual({
          server: "fixture",
          uri: README.uri,
          contents: [
            { type: "text", ...README },
            { type: "blob", ...LOGO },
          ],
        })

        // Skills are listed for every Location, loaded with their digests checked, and replace the instructions.
        const deploy = Skill.ID.make("fixture:deploy")
        for (const place of [a, b])
          yield* until("the skill", place.skills.list(), (list) => list.some((skill) => skill.id === deploy))
        expect(yield* b.skills.content(deploy)).toBe("# Deploy\n\nRun scripts/run.sh.\n")
        expect(yield* a.mcp.instructions()).toEqual([])

        yield* elicitations(a, b)

        // A Location's own connection answers with its directory; a shared one belongs to no directory.
        const roots = yield* a.mcp.callTool({ server: "fixture", name: "roots" }).pipe(Effect.result)
        if (row.shared) expect(roots._tag === "Failure" && roots.failure.message).toContain("roots/list")
        else
          expect(roots._tag === "Success" && roots.success.structured).toEqual({
            kind: "roots",
            roots: [{ uri: Bun.pathToFileURL(a.directory).href }],
          })

        // A list change the server announces reaches every Location it reaches. Separate processes keep separate lists.
        yield* a.mcp.callTool({ server: "fixture", name: "change" })
        for (const place of row.transport === "stdio" && !row.shared ? [a] : [a, b])
          yield* until("the added tool", place.mcp.tools(), (list) => list.some((tool) => tool.name === "added_1"))

        expect((yield* a.mcp.events("fixture")) !== undefined).toBe(row.events)
        if (row.events && server.events) {
          const subscription = yield* a.mcp.subscribe("fixture", { name: "job.finished" })
          yield* server.events.opened
          const eventId = server.events.emit()
          yield* until(
            "the event",
            Effect.sync(() => a.events),
            (events) => events.some((event) => event.type === "experimental.mcp.event"),
          )
          expect(a.events.find((event) => event.type === "experimental.mcp.event")?.data).toMatchObject({
            id: subscription.id,
            eventId,
            data: { eventId },
          })
        }
      }),
    )

  // A client-hosted server reaches only the tool surface.
  it.live("attached", () =>
    Effect.gen(function* () {
      const places = yield* world
      const a = yield* places.open({ directory: DIRECTORIES[0] })
      const b = yield* places.open({ directory: DIRECTORIES[1] })
      for (const place of [a, b]) {
        const [client, transport] = InMemoryTransport.createLinkedPair()
        const server = make({}, { added: [] }, () => void server.sendToolListChanged())
        yield* Effect.acquireRelease(
          Effect.promise(() => server.connect(transport)),
          () => Effect.promise(() => server.close()),
        )
        yield* place.mcp.attach("fixture", client)
      }
      expect(yield* a.mcp.servers()).toEqual([])
      yield* tools(a, b)
      yield* elicitations(a, b)
      expect((yield* a.mcp.callTool({ server: "fixture", name: "roots" })).structured).toEqual({
        kind: "roots",
        roots: [{ uri: Bun.pathToFileURL(a.directory).href }],
      })
      yield* a.mcp.callTool({ server: "fixture", name: "change" })
      yield* until("the added tool", a.mcp.tools(), (list) => list.some((tool) => tool.name === "added_1"))
    }),
  )
})

/** Serves the fixture for one path, with the config to reach it and a count of the connections it accepted. */
const fixture = (row: (typeof paths)[number]) =>
  Effect.gen(function* () {
    const spec = { era: row.era, skills: true, events: row.events }
    if (row.transport === "http") {
      const server = yield* serve(spec)
      return {
        config: remote(server.url, { pool: row.pool }),
        // Each connection lists tools once; the pool's attempt at a legacy server closes before listing.
        connections: Effect.sync(() => server.seen.lists),
        events: server,
      }
    }
    const pids = path.join((yield* tmpdirScoped()).path, "pids")
    return {
      // A fixed cwd lets Locations in different directories share a local server.
      config: stdio(spec, { pids, pool: row.pool, cwd: DIRECTORIES[0] }),
      connections: Effect.promise(() => fs.readFile(pids, "utf8")).pipe(
        Effect.map((text) => text.trim().split("\n").length),
      ),
      events: undefined,
    }
  })

// Lists the tools, and calls one with the session and a progress token.
const tools = (a: Place, b: Place) =>
  Effect.gen(function* () {
    expect((yield* a.mcp.tools()).map((tool) => tool.name)).toEqual([
      "agree",
      "ask",
      "change",
      "confirm",
      "echo",
      "result",
      "roots",
      "typed",
    ])
    expect(
      yield* b.mcp.callTool({ server: "fixture", name: "echo", args: { text: "hi" }, sessionID: SESSION }),
    ).toEqual({
      isError: false,
      content: [{ type: "text", text: "hi" }],
      structured: { args: { text: "hi" }, sessionID: SESSION, progress: true },
    })
  })

// A server's request for input becomes a form in the Location whose call caused it, and the answer goes back.
const elicitations = (a: Place, b: Place) =>
  Effect.gen(function* () {
    const confirm = yield* b.mcp.callTool({ server: "fixture", name: "confirm" }).pipe(Effect.forkScoped)
    const [url] = yield* until("the URL form", b.forms.list(), (forms) => forms.length === 1)
    expect(url?.fields).toEqual([{ key: "elicitation", type: "external", url: ELICITATION_URL }])
    expect(url?.metadata).toMatchObject({ kind: "mcp-elicitation", server: "fixture", message: "Authorize" })
    expect(yield* a.forms.list()).toEqual([])
    yield* b.forms.reply({ id: url!.id, answer: { elicitation: true } })
    expect((yield* Fiber.join(confirm)).structured).toEqual({ action: "accept" })

    const ask = yield* a.mcp.callTool({ server: "fixture", name: "ask" }).pipe(Effect.forkScoped)
    const [form] = yield* until("the form", a.forms.list(), (forms) => forms.length === 1)
    expect(form?.fields).toEqual([
      { key: "name", type: "string", title: "Name", required: true, minLength: 1 },
      {
        key: "size",
        type: "string",
        title: "size",
        options: [
          { value: "s", label: "Small" },
          { value: "m", label: "Medium" },
        ],
        custom: false,
      },
      { key: "count", type: "integer", title: "count", minimum: 1 },
      { key: "urgent", type: "boolean", title: "urgent" },
      {
        key: "tags",
        type: "multiselect",
        title: "tags",
        options: [
          { value: "a", label: "a" },
          { value: "b", label: "b" },
        ],
        custom: false,
      },
    ])
    const answer = { name: "x", size: "s", count: 2, urgent: true, tags: ["a"] }
    yield* a.forms.reply({ id: form!.id, answer })
    expect((yield* Fiber.join(ask)).structured).toEqual({ action: "accept", content: answer })

    // A form with no fields is accepted without asking anyone.
    const before = (yield* a.forms.list()).length
    expect((yield* a.mcp.callTool({ server: "fixture", name: "agree" })).structured).toEqual({ action: "accept" })
    expect(yield* a.forms.list()).toHaveLength(before)
  })
