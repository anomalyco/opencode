import { describe, expect } from "bun:test"
import fs from "node:fs/promises"
import { Mcp } from "@opencode/core/mcp/index"
import { Permission } from "@opencode/core/permission"
import { Session } from "@opencode/core/session"
import { Tool } from "@opencode/core/tool"
import { McpTool } from "@opencode/core/tool/mcp"
import { McpEventTools } from "@opencode/core/tool/plugin/mcp-events"
import { McpResourceTools } from "@opencode/core/tool/plugin/mcp-resource"
import { Deferred, Effect, Fiber, Layer, Schema } from "effect"
import { testEffect } from "../lib/effect"
import { permissionLayer } from "../lib/permission"
import { codeModeListings, executeTool, registerToolPlugin, toolIdentity } from "../lib/tool"
import { serve } from "./fixture/http"
import { README } from "./fixture/server"
import { remote, until, world } from "./harness"

const it = testEffect(Layer.empty)
const SESSION = Session.ID.make("ses_mcp_tool")

// What the model sees from MCP tools, through the tool registry of a Location connected to the fixture both directly
// (`direct`, Code Mode off) and through Code Mode (`fixture`). Permission decisions come from `decide`.
const setup = Effect.gen(function* () {
  const server = yield* serve({ era: "modern", events: true })
  const asked: Permission.AssertInput[] = []
  const decision = { current: Effect.void as Effect.Effect<void, Permission.Error> }
  const places = yield* world
  const permission = permissionLayer({
    assert: (input) => Effect.suspend(() => (asked.push(input), decision.current)),
  })
  const place = yield* places.open({
    servers: { fixture: remote(server.url), direct: remote(server.url, { codemode: false }) },
    permission,
  })
  const tools = place.tools
  yield* place.settled("fixture")
  yield* place.settled("direct")
  yield* place.mcpTool.flush
  const call = (name: string, input: Record<string, unknown> = {}) =>
    executeTool(tools, {
      sessionID: SESSION,
      ...toolIdentity,
      call: { type: "tool-call", id: `call_${name}`, name, input },
    })
  const run = (code: string) => call("execute", { code })
  return { server, place, tools, permission, asked, decision, call, run }
})

const text = (value: string) => ({ type: "text" as const, text: value })

describe("MCP tools", () => {
  it.live("return what the server produced, in the shape the model reads", () =>
    Effect.gen(function* () {
      const { call, run } = yield* setup
      const result = (value: unknown) => call("direct_result", { result: value })

      expect(yield* result({ isError: true, content: [text("search index unavailable")] })).toMatchObject({
        status: "error",
        error: { message: "search index unavailable" },
      })
      expect(
        yield* result({
          content: [text("rendered chart"), { type: "image", data: "aGVsbG8=", mimeType: "image/png" }],
        }),
      ).toMatchObject({
        output: "rendered chart",
        content: [text("rendered chart"), { type: "file", mime: "image/png", uri: "data:image/png;base64,aGVsbG8=" }],
      })
      // JSON text from a tool without an output schema is parsed for the model's output; the content keeps the text.
      expect(yield* result({ content: [text('{"issues":[{"id":1}]}')] })).toMatchObject({
        output: { issues: [{ id: 1 }] },
        content: [text('{"issues":[{"id":1}]}')],
      })
      expect(yield* result({ content: [], structuredContent: { ok: true } })).toMatchObject({ output: { ok: true } })

      // Textual blobs are inlined; other blobs are saved to a file the model can read.
      const blobs = yield* result({
        content: [
          {
            type: "resource",
            resource: { uri: "file:///README.md", mimeType: "text/markdown", blob: btoa("# Notes") },
          },
          {
            type: "resource",
            resource: { uri: "file:///data.parquet", mimeType: "application/vnd.apache.parquet", blob: "UEFSMQ==" },
          },
        ],
      })
      expect(blobs.content?.[0]).toEqual(text("[Resource file:///README.md (text/markdown)]\n# Notes"))
      const saved = /saved to (.+)\]$/.exec(blobs.content?.[1]?.type === "text" ? blobs.content[1].text : "")?.[1]
      expect(yield* Effect.promise(() => fs.readFile(saved ?? "", "utf8"))).toBe("PAR1")

      // Code Mode gets the parsed JSON, and the text of a content-only result.
      expect(
        (yield* run(
          'return (await tools.fixture.result({ result: { content: [{ type: "text", text: "{\\"id\\":7}" }] } })).id',
        )).output?.output,
      ).toBe("7")
      expect(
        (yield* run('return await tools.fixture.result({ result: { content: [{ type: "text", text: "hello" }] } })'))
          .content,
      ).toEqual([text("hello")])
    }),
  )

  it.live("carry the calling session and advertise output schemas", () =>
    Effect.gen(function* () {
      const { tools, call, run } = yield* setup
      // Names match V1's sanitization.
      expect(McpTool.name("context 7", "resolve.library/id")).toBe("context_7_resolve_library_id")
      const snapshot = yield* tools.snapshot()
      expect(codeModeListings(snapshot.codeModeCatalog!).find((tool) => tool.path === "fixture.typed")?.line).toContain(
        "ok: boolean",
      )
      expect(snapshot.definitions.find((tool) => tool.name === "direct_echo")?.inputSchema).not.toHaveProperty(
        "properties.sessionID",
      )
      expect((yield* call("direct_echo")).output).toMatchObject({ sessionID: SESSION })
      expect(JSON.parse((yield* run("return await tools.fixture.echo({})")).output?.output)).toMatchObject({
        sessionID: SESSION,
      })
    }),
  )

  it.live("ask permission before calling, and call nothing when it is refused", () =>
    Effect.gen(function* () {
      const { server, call, run, asked, decision } = yield* setup
      const granted = yield* Deferred.make<void>()
      decision.current = Deferred.await(granted)
      const waiting = yield* run("return await tools.fixture.echo({ text: 'open issues' })").pipe(Effect.forkScoped)
      yield* until(
        "the permission request",
        Effect.sync(() => asked.length),
        (count) => count === 1,
      )
      expect(asked[0]).toMatchObject({
        action: "fixture_echo",
        resources: ["*"],
        metadata: { input: { text: "open issues" } },
        sessionID: SESSION,
      })
      expect(server.seen.calls).toEqual([])
      yield* Deferred.succeed(granted, undefined)
      yield* Fiber.join(waiting)
      expect(server.seen.calls).toEqual(["echo"])

      decision.current = Effect.fail(
        new Permission.BlockedError({
          rules: [],
          permission: "fixture_echo",
          resources: ["*"],
          reason: "Search is disabled",
        }),
      )
      expect((yield* run("return await tools.fixture.echo({})")).content).toEqual([text("Search is disabled")])
      expect(yield* call("direct_echo")).toEqual({
        status: "error",
        error: { type: "permission.rejected", message: "Search is disabled" },
      })
      decision.current = Effect.fail(new Permission.CorrectedError({ feedback: "Search the docs instead" }))
      expect(yield* call("direct_echo")).toEqual({
        status: "error",
        error: { type: "permission.rejected", message: "Search the docs instead" },
      })
      expect(server.seen.calls).toEqual(["echo"])
    }),
  )

  it.live("keep plugin overrides when the server changes its tools", () =>
    Effect.gen(function* () {
      const { tools, call, place } = yield* setup
      yield* tools.transform((editor) =>
        editor.add({
          name: "echo",
          options: { namespace: "direct", codemode: false },
          description: "Override",
          input: Schema.Struct({}),
          output: Schema.String,
          execute: () => Effect.succeed({ output: "override" }),
        }),
      )
      yield* call("direct_change")
      yield* until("the added tool", tools.list(), (list) => list.some((tool) => tool.id === "direct_added_1"))
      yield* place.mcpTool.flush
      expect((yield* call("direct_echo")).output).toBe("override")
      expect((yield* call("direct_added_1")).output).toBe("added_1")
    }),
  )

  it.live("list and read resources and events through Code Mode", () =>
    Effect.gen(function* () {
      const { tools, run, asked, place, permission } = yield* setup
      yield* registerToolPlugin(McpResourceTools.Plugin).pipe(
        Effect.provideService(Tool.Service, tools),
        Effect.provideService(Mcp.Service, place.mcp),
        Effect.provide(permission),
      )
      yield* registerToolPlugin(McpEventTools.Plugin).pipe(
        Effect.provideService(Tool.Service, tools),
        Effect.provideService(Mcp.Service, place.mcp),
        Effect.provide(permission),
      )

      const listed = JSON.parse(
        (yield* run('return await tools.opencode.list_mcp_resources({ server: "fixture" })')).output?.output,
      )
      expect(listed.resources).toEqual([{ server: "fixture", name: "Readme", uri: README.uri }])
      const read = yield* run(
        'const resource = await tools.opencode.read_mcp_resource({ server: "fixture", uri: "docs://readme" }); return resource.contents[0].text',
      )
      expect(read.content).toEqual([
        text("hello"),
        { type: "file", uri: "data:image/png;base64,aGVsbG8=", mime: "image/png" },
      ])
      expect(asked.at(-1)).toMatchObject({ action: "opencode_read_mcp_resource", resources: ["fixture:docs://readme"] })
      const missing = yield* run(
        'return await tools.opencode.read_mcp_resource({ server: "missing", uri: "docs://readme" })',
      )
      expect(missing.output?.output).toContain("MCP server not found: missing")

      const events = JSON.parse(
        (yield* run('return await tools.opencode.list_mcp_events({ server: "fixture" })')).output?.output,
      )
      expect(events).toEqual({ events: [{ server: "fixture", event: "job.finished", args: {}, data: {} }] })
      yield* place.mcp.disconnect("direct")
      expect(
        (yield* run('return await tools.opencode.list_mcp_events({ server: "direct" })')).output?.output,
      ).toContain('MCP server "direct" is not connected or sends no events')
    }),
  )
})
