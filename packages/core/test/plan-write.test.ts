import fs from "fs/promises"
import path from "path"
import { describe, expect } from "bun:test"
import { Effect, Layer, Stream, type Types } from "effect"
import { Agent } from "@opencode/core/agent"
import { Bus } from "@opencode/core/bus"
import { Database } from "@opencode/core/database/database"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { Environment } from "@opencode/core/environment/index"
import { FileAccess } from "@opencode/core/file-access"
import { FileMutation } from "@opencode/core/file-mutation"
import { Formatter } from "@opencode/core/formatter"
import { Location } from "@opencode/core/location"
import { Permission } from "@opencode/core/permission"
import { PermissionSaved } from "@opencode/core/permission/saved"
import { PlanPlugin } from "@opencode/core/plugin/plan"
import { Project } from "@opencode/core/project"
import { ProjectTable } from "@opencode/core/project/sql"
import { AbsolutePath } from "@opencode/core/schema"
import { Session } from "@opencode/core/session"
import { SessionTable } from "@opencode/core/session/sql"
import { SessionStore } from "@opencode/core/session/store"
import { Tool } from "@opencode/core/tool"
import { WriteTool } from "@opencode/core/tool/plugin/write"
import { Global } from "@opencode/util/global"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { makeLocationNode } from "@opencode/util/effect/app-node"
import { host } from "./plugin/host"
import { location } from "./fixture/location"
import { tmpdir } from "./fixture/tmpdir"
import { testEffect } from "./lib/effect"
import { executeTool, registerToolPlugin, toolIdentity } from "./lib/tool"

// Real Plan plugin rules + real Permission + real FileAccess + real write tool; nothing about permissions is mocked.
const plan = Agent.ID.make("plan")
const sessionID = Session.ID.make("ses_plan_write_test")

const writeToolNode = makeLocationNode({
  name: "test/plan-write-tool-plugin",
  layer: Layer.effectDiscard(registerToolPlugin(WriteTool.Plugin)),
  deps: [Tool.node, FileAccess.node, FileMutation.node, Environment.node, Formatter.node, Permission.node],
})

const call = (input: typeof WriteTool.Input.Type) => ({
  sessionID,
  ...toolIdentity,
  agent: plan,
  call: { type: "tool-call" as const, id: "call-plan-write", name: "write", input },
})

/** Installs the Plan plugin's agent rules for `home`, then writes through the registry as the Plan agent. */
const asPlan = <A, E, R>(directory: string, home: string, body: (registry: Tool.Interface) => Effect.Effect<A, E, R>) =>
  Effect.gen(function* () {
    const { db } = yield* Database.Service
    yield* db
      .insert(ProjectTable)
      .values({ id: Project.ID.global, worktree: AbsolutePath.make(directory), sandboxes: [] })
      .onConflictDoNothing()
      .run()
      .pipe(Effect.orDie)
    yield* db
      .insert(SessionTable)
      .values({
        id: sessionID,
        project_id: Project.ID.global,
        slug: "test",
        directory,
        title: "test",
        version: "test",
        agent: "plan",
      })
      .onConflictDoNothing()
      .run()
      .pipe(Effect.orDie)
    // Capture the real Plan plugin's rules with a stub editor, then install them on the real Agent service.
    const planAgent = {
      id: plan,
      name: Agent.Name.make("Plan"),
      request: { settings: {}, headers: {}, body: {} },
      mode: "primary",
      hidden: false,
      permissions: [],
    } satisfies Types.DeepMutable<Agent.Info>
    yield* PlanPlugin.Plugin.effect(
      host({
        agent: {
          get: () => Effect.die("unused"),
          list: () => Effect.die("unused"),
          reload: () => Effect.die("unused"),
          transform: (callback) => {
            callback({
              list: () => [planAgent],
              get: (id) => (id === plan ? planAgent : undefined),
              default: () => {},
              update: (id, update) => {
                if (id === plan) update(planAgent)
              },
              remove: () => {},
            })
            return Effect.succeed({ dispose: Effect.void })
          },
        },
        tool: {
          transform: () => Effect.die("unused"),
          reload: () => Effect.die("unused"),
          list: () => Effect.die("unused"),
          hook: () => Effect.succeed({ dispose: Effect.void }),
        },
        event: { subscribe: () => Stream.empty },
        session: { hook: () => Effect.succeed({ dispose: Effect.void }) },
      }),
    ).pipe(
      Effect.provideService(Global.Service, Global.Service.of({ ...Global.make(), home })),
      Effect.provideService(
        Environment.Service,
        Environment.Service.of(
          (() => {
            const driver = Environment.makeMemoryDriver()
            return { files: Environment.makeFiles(driver), spawner: driver.spawner }
          })(),
        ),
      ),
    )
    const agents = yield* Agent.Service
    yield* agents.transform((editor) =>
      editor.update(plan, (agent) => {
        agent.permissions = [...planAgent.permissions]
      }),
    )
    return yield* body(yield* Tool.Service)
  }).pipe(
    Effect.provide(
      AppNodeBuilder.build(
        LayerNode.group([
          Database.node,
          Bus.node,
          SessionStore.node,
          PermissionSaved.node,
          Agent.node,
          Permission.node,
          Tool.node,
          FileAccess.node,
          FileMutation.node,
          writeToolNode,
        ]),
        [
          Location.node.replace(
            Layer.succeed(Location.Service, Location.Service.of(location({ directory: AbsolutePath.make(directory) }))),
          ),
          Formatter.node.replace(Layer.mock(Formatter.Service, { file: () => Effect.succeed(false) })),
        ],
      ),
    ),
  )

const exists = (file: string) =>
  Effect.promise(() =>
    fs.access(file).then(
      () => true,
      () => false,
    ),
  )

const it = testEffect(Layer.empty)

const withDirs = <A, E, R>(body: (dirs: { home: string; other: string }) => Effect.Effect<A, E, R>) =>
  Effect.acquireUseRelease(
    Effect.promise(() => Promise.all([tmpdir(), tmpdir()])),
    ([home, other]) => body({ home: home.path, other: other.path }),
    ([home, other]) =>
      Effect.promise(() =>
        Promise.all([home[Symbol.asyncDispose](), other[Symbol.asyncDispose]()]).then(() => undefined),
      ),
  )

describe("Plan agent writes", () => {
  it.live("writes to the Plan directory when it is inside the Location", () =>
    withDirs(({ home }) =>
      asPlan(home, home, (registry) =>
        Effect.gen(function* () {
          const settled = yield* executeTool(registry, call({ path: ".opencode/plan/work.md", content: "plan" }))
          expect(settled.status).toBe("completed")
          expect(
            yield* Effect.promise(() => fs.readFile(path.join(home, ".opencode", "plan", "work.md"), "utf8")),
          ).toBe("plan")
        }),
      ),
    ),
  )

  it.live("writes to the Plan directory by absolute path when it is inside the Location", () =>
    withDirs(({ home }) =>
      asPlan(home, home, (registry) =>
        Effect.gen(function* () {
          const file = path.join(home, ".opencode", "plan", "nested", "abs.md")
          expect((yield* executeTool(registry, call({ path: file, content: "plan" }))).status).toBe("completed")
          expect(yield* exists(file)).toBe(true)
        }),
      ),
    ),
  )

  it.live("writes to the Plan directory when it is outside the Location", () =>
    withDirs(({ home, other }) =>
      asPlan(other, home, (registry) =>
        Effect.gen(function* () {
          const file = path.join(home, ".opencode", "plan", "external.md")
          expect((yield* executeTool(registry, call({ path: file, content: "plan" }))).status).toBe("completed")
          expect(yield* exists(file)).toBe(true)
        }),
      ),
    ),
  )

  it.live("still blocks every other path", () =>
    withDirs(({ home }) =>
      asPlan(home, home, (registry) =>
        Effect.gen(function* () {
          for (const target of [
            "source.ts",
            ".opencode/other/x.md",
            ".opencode/plan-evil/x.md",
            ".opencode/plan/../escape.md",
            ".opencode/plan/../../escape.md",
          ]) {
            expect(yield* executeTool(registry, call({ path: target, content: "nope" }))).toMatchObject({
              status: "error",
              error: { type: "permission.rejected" },
            })
            expect(yield* exists(path.resolve(home, target))).toBe(false)
          }
        }),
      ),
    ),
  )
})
