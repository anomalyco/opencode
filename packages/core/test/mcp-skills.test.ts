import { describe, expect } from "bun:test"
import { McpServer, WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/server"
import { skillEntry, SkillsExtension, type Skill as ServedSkill } from "@modelcontextprotocol/server/ext/skills"
import { ConfigMCP } from "@opencode/schema/config/mcp"
import { Document, Info } from "@opencode/schema/config"
import { ConfigPolicy } from "@opencode/schema/config/policy"
import { Bus } from "@opencode/core/bus"
import { Config } from "@opencode/core/config"
import { Credential } from "@opencode/core/credential"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { Environment } from "@opencode/core/environment/index"
import { FileAccess } from "@opencode/core/file-access"
import { Flag } from "@opencode/core/flag"
import { Image } from "@opencode/core/image"
import { Integration } from "@opencode/core/integration"
import { Location } from "@opencode/core/location"
import { Mcp } from "@opencode/core/mcp/index"
import { Permission } from "@opencode/core/permission"
import { McpSkillPlugin } from "@opencode/core/plugin/mcp-skill"
import { AbsolutePath } from "@opencode/core/schema"
import { Session } from "@opencode/core/session"
import { SessionInstructions } from "@opencode/core/session/instructions"
import { Skill } from "@opencode/core/skill"
import { SkillInstructions } from "@opencode/core/skill/instructions"
import { Tool } from "@opencode/core/tool"
import { McpTool } from "@opencode/core/tool/mcp"
import { ReadTool } from "@opencode/core/tool/plugin/read"
import { SkillTool } from "@opencode/core/tool/plugin/skill"
import { ReadToolFileSystem } from "@opencode/core/tool/read-filesystem"
import { makeLocationNode } from "@opencode/util/effect/app-node"
import { FSUtil } from "@opencode/util/fs-util"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { isRecord } from "@opencode/util/record"
import { Effect, Layer } from "effect"
import { hostEnvironmentLayer } from "./fixture/environment"
import { tempLocationLayer } from "./fixture/location"
import { registerIntegrationPolicy } from "./fixture/policy"
import { host } from "./plugin/host"
import { testEffect } from "./lib/effect"
import { readInitial } from "./lib/instructions"
import { imagePassthrough } from "./lib/image"
import { permissionLayer } from "./lib/permission"
import { executeTool, registerToolPlugin, toolIdentity } from "./lib/tool"
import { eventually } from "./lib/eventually"

const sessionID = Session.ID.make("ses_mcp_skills")
const unused = () => Effect.die("unused integration service")
const assertions: Array<{ readonly action: string; readonly reads: number }> = []
let reads: string[] = []

const skillToolNode = makeLocationNode({
  name: "test/mcp-skills-skill-tool",
  layer: Layer.effectDiscard(registerToolPlugin(SkillTool.Plugin)),
  deps: [Tool.node, FSUtil.node, Skill.node, Permission.node],
})

const readToolNode = makeLocationNode({
  name: "test/mcp-skills-read-tool",
  layer: Layer.effectDiscard(registerToolPlugin(ReadTool.Plugin)),
  deps: [
    Tool.node,
    ReadToolFileSystem.node,
    FileAccess.node,
    Image.node,
    Permission.node,
    SessionInstructions.node,
    Skill.node,
    FSUtil.node,
    Environment.node,
    Location.node,
  ],
})

const mcpSkillNode = makeLocationNode({
  name: "test/mcp-skills-plugin",
  layer: Layer.effectDiscard(McpSkillPlugin.Plugin.effect(host())),
  deps: [Flag.node, Mcp.node, Bus.node, Skill.node],
})

// A local skill registered before MCP skills, as config and plugin skills are in production.
const shadowedMcpSkillNode = makeLocationNode({
  name: "test/mcp-skills-plugin-shadowed",
  layer: Layer.effectDiscard(
    Effect.gen(function* () {
      const skills = yield* Skill.Service
      yield* skills.transform((editor) =>
        editor.add({
          id: Skill.ID.make("team:deploy"),
          name: Skill.Name.make("team:deploy"),
          description: "Local",
          path: AbsolutePath.make("/local/team:deploy/SKILL.md"),
          content: "Local.",
        }),
      )
      yield* McpSkillPlugin.Plugin.effect(host())
    }),
  ),
  deps: [Flag.node, Mcp.node, Bus.node, Skill.node],
})

const stack = (flags: string, policies: ConfigPolicy.Info[] = [], plugin = mcpSkillNode) => {
  const config = Config.testLayer([new Document({ type: "document", info: new Info({ policies }) })])
  return AppNodeBuilder.build(
    LayerNode.group([
      Tool.node,
      Mcp.node,
      Skill.node,
      SkillInstructions.node,
      Bus.node,
      skillToolNode,
      readToolNode,
      plugin,
    ]),
    [
      Config.node.replace(config),
      Location.node.replace(tempLocationLayer),
      Environment.node.replace(hostEnvironmentLayer),
      Image.node.replace(imagePassthrough),
      Permission.node.replace(
        permissionLayer({
          assert: (input) => Effect.sync(() => assertions.push({ action: input.action, reads: reads.length })),
        }),
      ),
      Integration.node.replace(
        Layer.mock(Integration.Service, {
          revision: () => 0,
          connection: {
            active: unused,
            resolve: unused,
            key: unused,
            external: unused,
            activate: unused,
            update: unused,
            remove: unused,
            status: unused,
          },
          oauth: { connect: unused, status: unused, complete: unused, cancel: unused },
          command: { connect: unused, status: unused, cancel: unused },
        }),
      ),
      Credential.node.replace(Layer.mock(Credential.Service, {})),
    ],
  ).pipe(Layer.provideMerge(config), Layer.provide(Layer.succeed(Flag.Overrides, flags)))
}

const it = testEffect(stack("mcp_skills"))
const off = testEffect(stack("-mcp_skills"))

const DEPLOY = "---\nname: deploy\ndescription: Deploy the app\n---\n# Deploy\n\nRun scripts/run.sh.\n"
const REVIEW = "---\nname: review\ndescription: Review changes\n---\nReview.\n"
/**
 * A legacy Streamable HTTP MCP server publishing skills through the SDK's skills extension. Keys are skill folders
 * below `skill://`, each mapping file paths to contents; `serve` overrides what a file read returns. Records every
 * `resources/read`, `skills/list` and the client's declared capabilities.
 */
const skillServer = (skills: Record<string, Record<string, string | Uint8Array>>, tools: ReadonlyArray<string> = []) =>
  Effect.acquireRelease(
    Effect.promise(async () => {
      const entries: ServedSkill[] = await Promise.all(
        Object.entries(skills).map(([folder, files]) => skillEntry(folder, files)),
      )
      const served = new Map<string, string | Uint8Array>(
        Object.entries(skills).flatMap(([folder, files]) =>
          Object.entries(files).map(([file, content]) => [`skill://${folder}/${file}`, content] as const),
        ),
      )
      const state = { lists: 0, capabilities: undefined as unknown }
      const server = new McpServer({ name: "team", version: "1.0.0" })
      new SkillsExtension({
        source: {
          list: async () => ({ skills: entries }),
          get: async (uri) => entries.find((entry) => entry.uri === uri),
          read: async (uri) => {
            const content = served.get(uri)
            if (content === undefined) return undefined
            return typeof content === "string" ? { text: content } : { bytes: content, mimeType: "image/png" }
          },
        },
      }).attach(server)
      for (const tool of tools) server.registerTool(tool, { description: tool }, () => ({ content: [] }))
      const transport = new WebStandardStreamableHTTPServerTransport({
        sessionIdGenerator: () => crypto.randomUUID(),
        enableJsonResponse: true,
      })
      await server.connect(transport)
      reads = []
      const http = Bun.serve({
        port: 0,
        fetch: async (request) => {
          const body: unknown = request.method === "POST" ? await request.clone().json() : undefined
          if (isRecord(body) && isRecord(body.params)) {
            if (body.method === "resources/read" && typeof body.params.uri === "string") reads.push(body.params.uri)
            if (body.method === "initialize") state.capabilities = body.params.capabilities
          }
          if (isRecord(body) && body.method === "skills/list") state.lists += 1
          return transport.handleRequest(request)
        },
      })
      return {
        url: http.url.toString(),
        state,
        serve: (uri: string, content: string) => served.set(uri, content),
        close: async () => {
          await server.close().catch(() => {})
          await http.stop(true)
        },
      }
    }),
    (server) => Effect.promise(server.close),
  )

const connect = Effect.fnUntraced(function* (url: string, expected: ReadonlyArray<string>) {
  const mcp = yield* Mcp.Service
  const skills = yield* Skill.Service
  yield* mcp.add("team", new ConfigMCP.Remote({ type: "remote", url, oauth: false }))
  yield* eventually(mcp.servers(), (servers) => servers[0]?.status.status === "connected")
  return yield* eventually(skills.list({ content: false }), (listed) =>
    expected.every((id) => listed.some((skill) => skill.id === id)),
  )
})

const run = (id: string, name: string, input: Record<string, unknown>) =>
  Effect.gen(function* () {
    const tools = yield* Tool.Service
    return yield* executeTool(tools, { sessionID, ...toolIdentity, call: { type: "tool-call", id, name, input } })
  })

const deployFiles = {
  "SKILL.md": DEPLOY,
  "references/guide.md": "Guide line 1\nGuide line 2",
  "scripts/run.sh": "echo run",
}

describe("MCP skills", () => {
  off.live("declares nothing and registers no skills while the flag is off", () =>
    Effect.gen(function* () {
      const server = yield* skillServer({ deploy: deployFiles })
      const mcp = yield* Mcp.Service
      const skills = yield* Skill.Service
      yield* mcp.add("team", new ConfigMCP.Remote({ type: "remote", url: server.url, oauth: false }))
      yield* eventually(mcp.servers(), (servers) => servers[0]?.status.status === "connected")
      expect(server.state.capabilities).not.toMatchObject({ extensions: expect.anything() })
      expect(yield* mcp.skills()).toEqual([])
      expect(yield* skills.list({ content: false })).toEqual([])
      expect(server.state.lists).toBe(0)
    }),
  )

  it.live("lists server skills as <server>:<name> without reading any file", () =>
    Effect.gen(function* () {
      const server = yield* skillServer({ deploy: deployFiles })
      const listed = yield* connect(server.url, ["team:deploy"])
      expect(server.state.capabilities).toMatchObject({ extensions: { "io.modelcontextprotocol/skills": {} } })
      expect(listed).toEqual([
        {
          id: Skill.ID.make("team:deploy"),
          name: Skill.Name.make("team:deploy"),
          description: "Deploy the app",
          path: AbsolutePath.make("skill://team:deploy/SKILL.md"),
          server: "team",
        },
      ])
      const skills = yield* Skill.Service
      // Lists with content, such as GET /api/skill, never include skills that load lazily.
      expect(yield* skills.list()).toEqual([])
      expect(yield* skills.files(Skill.ID.make("team:deploy"))).toEqual(["references/guide.md", "scripts/run.sh"])
      const instructions = yield* SkillInstructions.Service
      expect((yield* instructions.load([]).pipe(Effect.flatMap(readInitial))).text).toContain("<id>team:deploy</id>")
      expect(reads).toEqual([])
    }),
  )

  it.live("hides a server's skills while the Session can use none of its tools", () =>
    Effect.gen(function* () {
      const server = yield* skillServer({ deploy: deployFiles }, ["ping"])
      const mcp = yield* Mcp.Service
      yield* connect(server.url, ["team:deploy"])
      yield* eventually(mcp.tools(), (tools) => tools.length === 1)
      const instructions = yield* SkillInstructions.Service
      const shown = yield* instructions.load([]).pipe(Effect.flatMap(readInitial))
      expect(shown.text).toContain("<id>team:deploy</id>")
      const denied = yield* instructions
        .load([{ action: McpTool.name("team", "ping"), resource: "*", effect: "deny" }])
        .pipe(Effect.flatMap(readInitial))
      expect(denied.text).not.toContain("team:deploy")
      expect(reads).toEqual([])
    }),
  )

  it.live("loads only SKILL.md through the skill tool, after authorization", () =>
    Effect.gen(function* () {
      const server = yield* skillServer({ deploy: deployFiles })
      yield* connect(server.url, ["team:deploy"])
      assertions.length = 0
      const result = yield* run("call-skill", "skill", { id: "team:deploy" })
      expect(result.status).toBe("completed")
      expect(result.output.directory).toBe("skill://team:deploy")
      expect(result.output.content).toContain("# Deploy\n\nRun scripts/run.sh.")
      expect(result.output.content).toContain("<file>skill://team:deploy/references/guide.md</file>")
      expect(result.output.content).toContain("<file>skill://team:deploy/scripts/run.sh</file>")
      expect(assertions).toEqual([{ action: "skill", reads: 0 }])
      expect(reads).toEqual(["skill://deploy/SKILL.md"])
    }),
  )

  it.live("reads one supporting file, and lists directories without reading", () =>
    Effect.gen(function* () {
      const server = yield* skillServer({ deploy: deployFiles })
      yield* connect(server.url, ["team:deploy"])
      const root = yield* run("call-root", "read", { path: "skill://team:deploy/" })
      expect(root.content).toEqual([
        { type: "text", text: "Read directory skill://team:deploy/, entries 1-3\nreferences/\nscripts/\nSKILL.md" },
      ])
      const folder = yield* run("call-folder", "read", { path: "skill://team:deploy/references" })
      expect(folder.content).toEqual([
        { type: "text", text: "Read directory skill://team:deploy/references, entries 1-1\nguide.md" },
      ])
      expect(reads).toEqual([])

      const file = yield* run("call-file", "read", { path: "skill://team:deploy/references/guide.md", offset: 2 })
      expect(file.content).toEqual([
        { type: "text", text: "Read file skill://team:deploy/references/guide.md, lines 2-2\n2: Guide line 2" },
      ])
      expect(reads).toEqual(["skill://deploy/references/guide.md"])

      const missing = yield* run("call-missing", "read", { path: "skill://team:deploy/references/other.md" })
      expect(missing.error?.message).toBe("File not found: skill://team:deploy/references/other.md")
      expect(reads).toEqual(["skill://deploy/references/guide.md"])
    }),
  )

  it.live("refuses files whose digest does not match the listing", () =>
    Effect.gen(function* () {
      const server = yield* skillServer({ deploy: deployFiles })
      yield* connect(server.url, ["team:deploy"])
      // Same size, other bytes.
      server.serve("skill://deploy/references/guide.md", "Guide line 1\nGuide line X")
      const file = yield* run("call-tampered", "read", { path: "skill://team:deploy/references/guide.md" })
      expect(file.status).toBe("error")
      expect(file.error?.message).toStartWith("Unable to read skill://team:deploy/references/guide.md: ")
      expect(file.error?.message).toContain("digest")

      server.serve("skill://deploy/SKILL.md", DEPLOY.replace("Run", "Skip"))
      const skill = yield* run("call-tampered-skill", "skill", { id: "team:deploy" })
      expect(skill.status).toBe("error")
      expect(skill.error?.message).toStartWith("Unable to load skill team:deploy: ")
      expect(reads).toEqual(["skill://deploy/references/guide.md", "skill://deploy/SKILL.md"])
    }),
  )

  it.live("tells same-named skills of one server apart by their paths", () =>
    Effect.gen(function* () {
      const server = yield* skillServer({
        "support/refunds": { "SKILL.md": "---\nname: refunds\ndescription: Support\n---\nS\n" },
        "billing/refunds": { "SKILL.md": "---\nname: refunds\ndescription: Billing\n---\nB\n" },
        deploy: { "SKILL.md": DEPLOY },
      })
      const listed = yield* connect(server.url, ["team:billing.refunds", "team:deploy", "team:support.refunds"])
      expect(listed.map((skill) => [skill.id, skill.description]).toSorted()).toEqual([
        ["team:billing.refunds", "Billing"],
        ["team:deploy", "Deploy the app"],
        ["team:support.refunds", "Support"],
      ])
      const result = yield* run("call-support", "skill", { id: "team:support.refunds" })
      expect(result.output.content).toContain("\nS\n")
      expect(reads).toEqual(["skill://support/refunds/SKILL.md"])
    }),
  )

  testEffect(stack("mcp_skills", [], shadowedMcpSkillNode)).live(
    "keeps a skill that already uses an MCP skill's ID",
    () =>
      Effect.gen(function* () {
        const server = yield* skillServer({ deploy: deployFiles, review: { "SKILL.md": REVIEW } })
        const skills = yield* Skill.Service
        yield* connect(server.url, ["team:review"])
        expect((yield* skills.get(Skill.ID.make("team:deploy"), { content: false }))?.description).toBe("Local")
        expect(reads).toEqual([])
      }),
  )

  testEffect(stack("mcp_skills", [{ action: "skill.use", resource: "team:*", effect: "deny" }])).live(
    "removes MCP skills that policy denies",
    () =>
      Effect.gen(function* () {
        const server = yield* skillServer({ deploy: deployFiles, review: { "SKILL.md": REVIEW } })
        const skills = yield* Skill.Service
        yield* connect(server.url, ["team:deploy"])
        yield* registerIntegrationPolicy({ skill: skills })
        expect(yield* skills.list({ content: false })).toEqual([])
        const result = yield* run("call-denied", "skill", { id: "team:deploy" })
        expect(result.status).toBe("error")
        expect(reads).toEqual([])
      }),
  )
})
