import path from "node:path"
import { mkdir, rm } from "node:fs/promises"
import { describe, expect } from "bun:test"
import { Context, Effect, Layer, Schedule, Stream } from "effect"
import { ConfigMCP } from "@opencode/schema/config/mcp"
import { McpEvent } from "@opencode/schema/mcp-event"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { Database } from "@opencode/core/database/database"
import { Bus } from "@opencode/core/bus"
import { Instance } from "@opencode/core/instance/service"
import { Location } from "@opencode/core/location"
import { LocationServiceMap } from "@opencode/core/location-services"
import { Mcp } from "@opencode/core/mcp/index"
import { McpSession } from "@opencode/core/mcp/session"
import { Project } from "@opencode/core/project"
import { AbsolutePath } from "@opencode/core/schema"
import { Session } from "@opencode/core/session"
import { SessionEnvironment } from "@opencode/core/session/environment"
import { SessionExecution } from "@opencode/core/session/execution"
import { SessionModelTransport } from "@opencode/core/session/model-transport"
import { SessionProjector } from "@opencode/core/session/projector"
import { SessionStore } from "@opencode/core/session/store"
import { Tool } from "@opencode/core/tool"
import { McpTool } from "@opencode/core/tool/mcp"
import { testEffect } from "./lib/effect"
import { globalProjectNode } from "./lib/project"
import { codeModeListings, waitForCodeModeTool } from "./lib/tool"
import { offlineModels } from "./fixture/models"
import { tmpdirScoped } from "./fixture/tmpdir"

const transport = Layer.succeed(
  SessionModelTransport.Service,
  SessionModelTransport.Service.of({
    bind: () => ({ execute: () => Effect.die("Unexpected WebSocket execution") }),
    close: () => Effect.void,
    closeAll: Effect.void,
  }),
)

const it = testEffect(
  AppNodeBuilder.build(
    LayerNode.group([
      Database.node,
      Bus.node,
      SessionProjector.node,
      SessionStore.node,
      SessionEnvironment.node,
      Session.node,
      Instance.node,
      LocationServiceMap.node,
    ]),
    [
      Project.node.replace(globalProjectNode),
      SessionExecution.node.replace(SessionExecution.noopLayer),
      SessionModelTransport.node.replace(transport),
      offlineModels,
    ],
  ),
)

const fixture = (subdirectory?: string) =>
  Effect.gen(function* () {
    const temporary = yield* tmpdirScoped()
    const directory = subdirectory ? path.join(temporary.path, subdirectory) : temporary.path
    if (subdirectory) yield* Effect.promise(() => mkdir(directory))
    const location = Location.Ref.make({ directory: AbsolutePath.make(directory) })
    const locations = yield* LocationServiceMap.Service
    const context = yield* Effect.acquireRelease(locations.contextEffect(location), () =>
      locations.invalidate(location),
    )
    const pidFile = (identity: string) => path.join(temporary.path, `${identity}.pid`)
    return {
      root: AbsolutePath.make(temporary.path),
      directory,
      location,
      server: (identity: string) =>
        new ConfigMCP.Local({
          type: "local",
          command: [
            process.execPath,
            path.join(import.meta.dir, "fixture/mcp-identity.ts"),
            identity,
            pidFile(identity),
          ],
        }),
      pid: (identity: string) => Effect.promise(() => Bun.file(pidFile(identity)).text()).pipe(Effect.map(Number)),
      mcp: Context.get(context, Mcp.Service),
      sessions: Context.get(context, McpSession.Service),
      mcpTools: Context.get(context, McpTool.Service),
      registry: Context.get(context, Tool.Service),
    }
  })

const text = (result: Mcp.ToolResult) =>
  result.content.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("")

// The harness still reads the user's global config, so assertions only look at the fixture's server.
const names = (tools: ReadonlyArray<Mcp.Tool>) =>
  tools.filter((tool) => tool.server === "ctx").map((tool) => `${tool.server}.${tool.name}`)
const owned = (view: McpSession.View) => names(view.owned.map((item) => item.tool))

const whoami = (view: McpSession.View, sessionID: Session.ID) =>
  Effect.gen(function* () {
    const tool = view.owned.find((item) => item.tool.server === "ctx" && item.tool.name === "whoami")
    if (!tool) return yield* Effect.die(new Error("whoami is not owned by this view"))
    return text(yield* tool.call({ sessionID }))
  })

const running = (pid: number) => {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

const exited = (pid: number) =>
  Effect.suspend(() => (running(pid) ? Effect.fail(`process ${pid} is still running`) : Effect.void)).pipe(
    Effect.retry({ times: 300, schedule: Schedule.spaced("10 millis") }),
  )

describe("Session-scoped MCP servers", () => {
  it.live("are visible only to their Session tree and shadow Location servers there", () =>
    Effect.gen(function* () {
      const test = yield* fixture()
      const sessions = yield* Session.Service
      const root = yield* sessions.create({ location: test.location })
      const child = yield* sessions.create({ parentID: root.id })
      const other = yield* sessions.create({ location: test.location })
      const bystander = yield* sessions.create({ location: test.location })
      const broken = yield* sessions.create({ location: test.location })

      yield* test.sessions.add(root.id, "ctx", test.server("root"))

      expect(owned(yield* test.sessions.view(root.id))).toEqual(["ctx.only_root", "ctx.whoami"])
      expect(owned(yield* test.sessions.view(child.id))).toEqual(["ctx.only_root", "ctx.whoami"])
      expect(owned(yield* test.sessions.view(other.id))).toEqual([])
      expect(names(yield* test.mcp.tools())).toEqual([])
      expect((yield* test.mcp.servers()).some((server) => server.name === "ctx")).toBe(false)
      expect((yield* test.sessions.view(child.id)).servers.some((server) => server.name === "ctx")).toBe(true)
      expect(yield* whoami(yield* test.sessions.view(child.id), child.id)).toBe("root")

      yield* test.sessions.add(other.id, "ctx", test.server("other"))
      yield* test.sessions.add(broken.id, "ctx", new ConfigMCP.Local({ type: "local", command: ["false"] }))
      yield* test.mcp.add("ctx", test.server("location"))

      expect(yield* whoami(yield* test.sessions.view(root.id), root.id)).toBe("root")
      expect(yield* whoami(yield* test.sessions.view(other.id), other.id)).toBe("other")
      expect(text(yield* test.mcp.callTool({ server: "ctx", name: "whoami", sessionID: bystander.id }))).toBe(
        "location",
      )
      const rootView = yield* test.sessions.view(root.id)
      expect(rootView.shadowed.has("ctx")).toBe(true)
      expect(names(rootView.tools)).toEqual([])
      const bystanderView = yield* test.sessions.view(bystander.id)
      expect(bystanderView.shadowed.size).toBe(0)
      expect(names(bystanderView.tools)).toEqual(["ctx.only_location", "ctx.whoami"])

      yield* waitForCodeModeTool(test.registry, "ctx.only_location")
      const listed = (sessionID: Session.ID) =>
        test.sessions.view(sessionID).pipe(
          Effect.flatMap(test.mcpTools.overlay),
          Effect.flatMap((overlay) => test.registry.snapshot(undefined, overlay)),
          Effect.map((snapshot) =>
            (snapshot.codeModeCatalog ? codeModeListings(snapshot.codeModeCatalog) : [])
              .map((tool) => tool.path)
              .filter((path) => path.startsWith("ctx.")),
          ),
        )
      expect(yield* listed(child.id)).toEqual(["ctx.only_root", "ctx.whoami"])
      expect(yield* listed(bystander.id)).toEqual(["ctx.only_location", "ctx.whoami"])
      expect(yield* listed(broken.id)).toEqual([])
    }),
  )

  it.live("releases servers on replacement, removal, and Session deletion without Location events", () =>
    Effect.gen(function* () {
      const test = yield* fixture()
      const sessions = yield* Session.Service
      const bus = yield* Bus.Service
      const events: string[] = []
      yield* bus
        .subscribe([McpEvent.StatusChanged, McpEvent.ToolsChanged, McpEvent.ResourcesChanged, Mcp.PromptsChanged])
        .pipe(
          Stream.runForEach((event) => Effect.sync(() => events.push(`${event.type}:${event.data.server}`))),
          Effect.forkScoped({ startImmediately: true }),
        )
      const first = yield* sessions.create({ location: test.location })
      const second = yield* sessions.create({ location: test.location })

      yield* test.sessions.add(first.id, "ctx", test.server("first"))
      yield* test.sessions.add(second.id, "ctx", test.server("second"))
      const firstPid = yield* test.pid("first")
      const secondPid = yield* test.pid("second")

      yield* test.sessions.add(first.id, "ctx", test.server("first"))
      expect(yield* test.pid("first")).toBe(firstPid)
      expect(running(firstPid)).toBe(true)

      yield* test.sessions.add(first.id, "ctx", test.server("replaced"))
      yield* exited(firstPid)
      expect(yield* whoami(yield* test.sessions.view(first.id), first.id)).toBe("replaced")
      expect(yield* whoami(yield* test.sessions.view(second.id), second.id)).toBe("second")
      expect(running(secondPid)).toBe(true)

      const replacedPid = yield* test.pid("replaced")
      yield* test.sessions.remove(first.id, "ctx")
      yield* exited(replacedPid)
      expect(owned(yield* test.sessions.view(first.id))).toEqual([])
      expect(yield* test.sessions.remove(first.id, "ctx").pipe(Effect.flip)).toBeInstanceOf(Mcp.NotFoundError)

      yield* sessions.remove(second.id)
      yield* exited(secondPid)
      expect(owned(yield* test.sessions.view(second.id))).toEqual([])

      yield* test.mcp.add("probe", new ConfigMCP.Local({ type: "local", command: ["unused"], disabled: true }))
      yield* Effect.suspend(() =>
        events.includes(`${McpEvent.StatusChanged.type}:probe`) ? Effect.void : Effect.fail("probe event missing"),
      ).pipe(Effect.retry({ times: 100, schedule: Schedule.spaced("10 millis") }))
      expect(events.filter((event) => event.endsWith(":ctx"))).toEqual([])
    }),
  )

  it.live("releases servers in the former Location when their Session moves", () =>
    Effect.gen(function* () {
      const test = yield* fixture("source")
      const sessions = yield* Session.Service
      const session = yield* sessions.create({ location: test.location })

      yield* test.sessions.add(session.id, "ctx", test.server("moved"))
      const pid = yield* test.pid("moved")
      // A missing source directory applies the move immediately instead of at a step boundary.
      yield* Effect.promise(() => rm(test.directory, { recursive: true }))
      yield* sessions.move({ sessionID: session.id, directory: test.root })

      expect((yield* sessions.get(session.id)).location.directory).toBe(test.root)
      yield* exited(pid)
      expect(owned(yield* test.sessions.view(session.id))).toEqual([])
    }),
  )
})
