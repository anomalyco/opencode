import path from "node:path"
import { expect } from "bun:test"
import { Deferred, Effect, Fiber, Layer } from "effect"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { Agent } from "@opencode/core/agent"
import { Bus } from "@opencode/core/bus"
import { Config } from "@opencode/core/config"
import { Database } from "@opencode/core/database/database"
import { Environment } from "@opencode/core/environment/index"
import { Location } from "@opencode/core/location"
import { Mcp } from "@opencode/core/mcp/index"
import { McpTool } from "@opencode/core/tool/mcp"
import { Permission } from "@opencode/core/permission"
import { Project } from "@opencode/core/project"
import { ProjectTable } from "@opencode/core/project/sql"
import { AbsolutePath } from "@opencode/core/schema"
import { Session } from "@opencode/core/session"
import { SessionTable } from "@opencode/core/session/sql"
import { Tool } from "@opencode/core/tool"
import { ConfigMCP } from "@opencode/schema/config/mcp"
import { SessionMessage } from "@opencode/schema/session-message"
import { hostEnvironmentLayer } from "./fixture/environment"
import { location } from "./fixture/location"
import { testEffect } from "./lib/effect"
import { waitForCodeModeTool } from "./lib/tool"

const directory = AbsolutePath.make(import.meta.dir)
const it = testEffect(
  AppNodeBuilder.build(
    LayerNode.group([Tool.node, McpTool.node, Mcp.node, Permission.node, Bus.node, Agent.node, Database.node]),
    [
      Location.node.replace(Layer.succeed(Location.Service, Location.Service.of(location({ directory })))),
      Config.node.replace(Config.testLayer()),
      Environment.node.replace(hostEnvironmentLayer),
    ],
  ),
)

for (const mode of ["single", "parallel", "always", "reject", "cancel"] as const) {
  it.live(`Code Mode MCP permissions settle and retain the outer source (${mode})`, () =>
    Effect.gen(function* () {
      const db = (yield* Database.Service).db
      const sessionID = Session.ID.make(`ses_mcp_permission_${mode}`)
      const agent = Agent.ID.make("build")
      const messageID = SessionMessage.ID.make("msg_mcp_permission")
      yield* db
        .insert(ProjectTable)
        .values({ id: Project.ID.global, worktree: directory, sandboxes: [] })
        .onConflictDoNothing()
        .run()
        .pipe(Effect.orDie)
      yield* db
        .insert(SessionTable)
        .values({
          id: sessionID,
          project_id: Project.ID.global,
          slug: "mcp",
          directory,
          title: "MCP",
          version: "test",
          agent,
        })
        .onConflictDoNothing()
        .run()
        .pipe(Effect.orDie)
      const agents = yield* Agent.Service
      yield* agents.transform((editor) =>
        editor.update(agent, (value) => {
          value.permissions = [{ action: "local_*", resource: "*", effect: "ask" }]
        }),
      )
      const mcp = yield* Mcp.Service
      yield* mcp.add(
        "local",
        new ConfigMCP.Local({
          type: "local",
          command: [process.execPath, path.join(import.meta.dir, "fixture/mcp-permission.ts")],
        }),
      )
      const registry = yield* Tool.Service
      const snapshot = yield* waitForCodeModeTool(registry, "local.echo")
      const permission = yield* Permission.Service
      const bus = yield* Bus.Service
      const concurrent = mode === "parallel" || mode === "always"
      const requests: Permission.Request[] = []
      const asked = yield* Deferred.make<void>()
      const unsubscribe = yield* bus.listen((event) =>
        Effect.gen(function* () {
          if (event.type !== Permission.Event.Asked.type) return
          requests.push(event.data as Permission.Request)
          if (requests.length === (concurrent ? 2 : 1)) yield* Deferred.succeed(asked, undefined)
        }),
      )
      yield* Effect.addFinalizer(() => unsubscribe)
      const fiber = yield* snapshot
        .execute({
          sessionID,
          agent,
          messageID,
          call: {
            type: "tool-call",
            id: "call_outer",
            name: "execute",
            input: {
              code: concurrent
                ? "return await Promise.all([tools.local.echo({}), tools.local.echo({})])"
                : "return await tools.local.echo({})",
            },
          },
        })
        .pipe(Effect.forkScoped)
      yield* Deferred.await(asked).pipe(Effect.timeout("5 seconds"))
      const request = requests[0]!
      expect(request).toMatchObject({
        sessionID,
        action: "local_echo",
        source: { type: "tool", messageID, id: "call_outer" },
      })
      expect(yield* permission.list()).toHaveLength(concurrent ? 2 : 1)
      for (const pending of requests) expect(pending.source).toEqual(request.source)
      if (mode === "cancel") {
        yield* Fiber.interrupt(fiber)
      } else if (mode === "reject") {
        yield* permission.reply({ requestID: request.id, reply: "reject" })
        const result = yield* Fiber.join(fiber).pipe(Effect.timeout("5 seconds"))
        expect(result.metadata).toMatchObject({ error: true })
        expect(JSON.stringify(result.content)).not.toContain("echo completed")
      } else {
        yield* permission.reply({ requestID: request.id, reply: mode === "always" ? "always" : "once" })
        if (mode === "parallel") {
          expect(yield* permission.list()).toHaveLength(1)
          yield* permission.reply({ requestID: requests[1]!.id, reply: "once" })
        }
        const result = yield* Fiber.join(fiber).pipe(Effect.timeout("5 seconds"))
        expect(result.content).toEqual([
          { type: "text", text: concurrent ? '[\n  "echo completed",\n  "echo completed"\n]' : "echo completed" },
        ])
      }
      expect(yield* permission.list()).toHaveLength(0)
    }),
  )
}
