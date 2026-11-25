import { describe, expect } from "bun:test"
import { McpServer, WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/server"
import { skillEntry, SkillsExtension, type Skill as ServedSkill } from "@modelcontextprotocol/server/ext/skills"
import { ConfigMCP } from "@opencode/schema/config/mcp"
import { Document, Info } from "@opencode/schema/config"
import { Bus } from "@opencode/core/bus"
import { Config } from "@opencode/core/config"
import { Flag } from "@opencode/core/flag"
import { Credential } from "@opencode/core/credential"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { Environment } from "@opencode/core/environment/index"
import { Integration } from "@opencode/core/integration"
import { Location } from "@opencode/core/location"
import { Mcp } from "@opencode/core/mcp/index"
import { McpSkillPlugin } from "@opencode/core/plugin/mcp-skill"
import { AbsolutePath } from "@opencode/core/schema"
import { Skill } from "@opencode/core/skill"
import { makeLocationNode } from "@opencode/util/effect/app-node"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { isRecord } from "@opencode/util/record"
import { Effect, Layer } from "effect"
import { hostEnvironmentLayer } from "./fixture/environment"
import { tempLocationLayer } from "./fixture/location"
import { host } from "./plugin/host"
import { testEffect } from "./lib/effect"
import { eventually } from "./lib/eventually"

const unused = () => Effect.die("unused integration service")
const config = Config.testLayer([new Document({ type: "document", info: new Info({}) })])
const it = testEffect(
  AppNodeBuilder.build(
    LayerNode.group([
      Mcp.node,
      Skill.node,
      Bus.node,
      makeLocationNode({
        name: "test/mcp-skills-plugin",
        layer: Layer.effectDiscard(McpSkillPlugin.Plugin.effect(host())),
        deps: [Mcp.node, Bus.node, Skill.node],
      }),
    ]),
    [
      Config.node.replace(config),
      Flag.node.replace(Flag.testLayer([], { overrides: "mcp_skills" })),
      Location.node.replace(tempLocationLayer),
      Environment.node.replace(hostEnvironmentLayer),
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
  ).pipe(Layer.provideMerge(config)),
)

const DEPLOY = "---\nname: deploy\ndescription: Deploy the app\n---\n# Deploy\n\nRun scripts/run.sh.\n"
const deploy = { "SKILL.md": DEPLOY, "scripts/run.sh": "echo run" }
const id = Skill.ID.make("team:deploy")

/**
 * A Streamable HTTP MCP server publishing skills through the SDK's skills extension. Keys are skill folders below
 * `skill://`, each mapping file paths to contents; `serve` changes what a file read returns. Records every
 * `resources/read` and the client's declared capabilities.
 */
const skillServer = (
  skills: Record<string, Record<string, string>>,
  options: { instructions?: string; extra?: ServedSkill[] } = {},
) =>
  Effect.acquireRelease(
    Effect.promise(async () => {
      const entries = [
        ...(await Promise.all(Object.entries(skills).map(([folder, files]) => skillEntry(folder, files)))),
        ...(options.extra ?? []),
      ]
      const served = new Map<string, string>(
        Object.entries(skills).flatMap(([folder, files]) =>
          Object.entries(files).map(([file, content]) => [`skill://${folder}/${file}`, content] as const),
        ),
      )
      const state = { reads: [] as string[], capabilities: undefined as unknown }
      const server = new McpServer({ name: "team", version: "1.0.0" }, { instructions: options.instructions })
      new SkillsExtension({
        source: {
          list: async () => ({ skills: entries }),
          get: async (uri) => entries.find((entry) => entry.uri === uri),
          read: async (uri) => {
            const text = served.get(uri)
            return text === undefined ? undefined : { text }
          },
        },
      }).attach(server)
      const transport = new WebStandardStreamableHTTPServerTransport({
        sessionIdGenerator: () => crypto.randomUUID(),
        enableJsonResponse: true,
      })
      await server.connect(transport)
      const http = Bun.serve({
        port: 0,
        fetch: async (request) => {
          const body: unknown = request.method === "POST" ? await request.clone().json() : undefined
          if (isRecord(body) && isRecord(body.params)) {
            if (body.method === "resources/read" && typeof body.params.uri === "string")
              state.reads.push(body.params.uri)
            if (body.method === "initialize") state.capabilities = body.params.capabilities
          }
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

const connect = Effect.fnUntraced(function* (name: string, url: string, expected: ReadonlyArray<string>) {
  const mcp = yield* Mcp.Service
  const skills = yield* Skill.Service
  yield* mcp.add(name, new ConfigMCP.Remote({ type: "remote", url, oauth: false }))
  yield* eventually(mcp.servers(), (servers) =>
    servers.some((server) => server.name === name && server.status.status === "connected"),
  )
  return yield* eventually(skills.list(), (listed) => expected.every((id) => listed.some((skill) => skill.id === id)))
})

describe("MCP skills", () => {
  it.live("lists skills as <server>:<name> without reading, and refuses dynamic ones", () =>
    Effect.gen(function* () {
      const server = yield* skillServer(
        { deploy },
        {
          extra: [
            {
              uri: "skill://live/SKILL.md",
              frontmatter: { name: "live", description: "Generated" },
              resources: "dynamic",
            },
          ],
        },
      )
      const listed = yield* connect("team", server.url, ["team:deploy"])
      expect(server.state.capabilities).toMatchObject({ extensions: { "io.modelcontextprotocol/skills": {} } })
      expect(listed).toEqual([
        {
          id,
          name: Skill.Name.make("team:deploy"),
          description: "Deploy the app",
          path: AbsolutePath.make(Skill.uri(id, "SKILL.md")),
          content: "",
        },
      ])
      const skills = yield* Skill.Service
      expect(yield* skills.files(id)).toEqual(["scripts/run.sh"])
      expect(server.state.reads).toEqual([])
    }),
  )

  it.live("tells same-named skills of one server apart by their paths", () =>
    Effect.gen(function* () {
      const refunds = (team: string) => ({
        "SKILL.md": `---\nname: refunds\ndescription: ${team} refunds\n---\n# Refunds\n`,
      })
      const server = yield* skillServer({
        "acme/billing/refunds": refunds("Billing"),
        "acme/support/refunds": refunds("Support"),
      })
      const listed = yield* connect("team", server.url, ["team:billing.refunds", "team:support.refunds"])
      expect(listed.map((skill) => [skill.id, skill.description]).toSorted()).toEqual([
        ["team:billing.refunds", "Billing refunds"],
        ["team:support.refunds", "Support refunds"],
      ])
    }),
  )

  it.live("loads verified files on demand and reuses them by digest", () =>
    Effect.gen(function* () {
      const server = yield* skillServer({ deploy })
      yield* connect("team", server.url, ["team:deploy"])
      const skills = yield* Skill.Service
      expect(yield* skills.content(id)).toBe("# Deploy\n\nRun scripts/run.sh.\n")
      expect(new TextDecoder().decode(yield* skills.read(id, "scripts/run.sh"))).toBe("echo run")
      // Once loaded, the content is listed and nothing is read again.
      yield* eventually(skills.get(id), (skill) => skill?.content === "# Deploy\n\nRun scripts/run.sh.\n")
      yield* skills.content(id)
      yield* skills.read(id, "scripts/run.sh")
      expect(server.state.reads).toEqual(["skill://deploy/SKILL.md", "skill://deploy/scripts/run.sh"])
    }),
  )

  it.live("fails a load whose digest does not match the listing", () =>
    Effect.gen(function* () {
      const server = yield* skillServer({ deploy })
      yield* connect("team", server.url, ["team:deploy"])
      // Same size, other bytes.
      server.serve("skill://deploy/scripts/run.sh", "echo ran")
      server.serve("skill://deploy/SKILL.md", DEPLOY.replace("Run", "Ran"))
      const skills = yield* Skill.Service
      const content = yield* skills.content(id).pipe(Effect.flip)
      expect(content).toBeInstanceOf(Skill.LoadError)
      expect(content.message).toStartWith("Failed to load SKILL.md of MCP skill team:deploy: ")
      expect(content.message).toContain("digest")
      const file = yield* skills.read(id, "scripts/run.sh").pipe(Effect.flip)
      expect(file.message).toContain("digest")
    }),
  )

  it.live("leaves out the instructions of servers that offer skills", () =>
    Effect.gen(function* () {
      const withSkills = yield* skillServer({ deploy }, { instructions: "Use the deploy skill." })
      // Dynamic skills aren't registered, so they don't replace instructions.
      const without = yield* skillServer(
        {},
        {
          instructions: "Call ping.",
          extra: [
            {
              uri: "skill://live/SKILL.md",
              frontmatter: { name: "live", description: "Generated" },
              resources: "dynamic",
            },
          ],
        },
      )
      yield* connect("team", withSkills.url, ["team:deploy"])
      yield* connect("other", without.url, [])
      const mcp = yield* Mcp.Service
      expect(yield* mcp.instructions()).toEqual([{ server: Mcp.ServerName.make("other"), instructions: "Call ping." }])
    }),
  )
})
