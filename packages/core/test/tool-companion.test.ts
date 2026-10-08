import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { Global } from "@opencode/util/global"
import { makeGlobalNode, makeLocationNode } from "@opencode/util/effect/app-node"
import { Database } from "@opencode/core/database/database"
import { Bus } from "@opencode/core/bus"
import { Location } from "@opencode/core/location"
import { AbsolutePath } from "@opencode/core/schema"
import { Job } from "@opencode/core/job"
import { LocationServiceMap } from "@opencode/core/location-service-map"
import { Session } from "@opencode/core/session"
import { SessionExecution } from "@opencode/core/session/execution"
import { Plugin } from "@opencode/core/plugin"
import { PluginHooks } from "@opencode/core/plugin/hooks"
import { PluginSupervisor } from "@opencode/core/plugin/supervisor"
import { Permission } from "@opencode/core/permission"
import { CompanionTools } from "@opencode/core/tool/plugin/companion"
import { Tool } from "@opencode/core/tool"
import { Agent } from "@opencode/core/agent"
import { Model } from "@opencode/schema/model"
import { Provider } from "@opencode/schema/provider"
import { tmpdir } from "./fixture/tmpdir"
import { tempGlobalLayer } from "./fixture/global"
import { offlineModels } from "./fixture/models"
import { testEffect } from "./lib/effect"
import { executeTool, registerToolPlugin, toolIdentity } from "./lib/tool"

// Prompts are admitted durably; nothing needs to run for these tools to observe the inbox.
const executionNode = makeGlobalNode({
  service: SessionExecution.Service,
  layer: Layer.succeed(
    SessionExecution.Service,
    SessionExecution.Service.of({
      active: Effect.succeed(new Set()),
      isActive: () => Effect.succeed(false),
      resume: () => Effect.void,
      wake: () => Effect.void,
      interrupt: () => Effect.succeed(false),
      awaitIdle: () => Effect.void,
    }),
  ),
  deps: [],
})

const companionPluginSupervisor = makeLocationNode({
  name: "test/companion-plugins",
  layer: Layer.effectDiscard(
    Effect.gen(function* () {
      const hooks = yield* PluginHooks.Service
      yield* registerToolPlugin(
        CompanionTools.Plugin,
        {
          permission: {
            hook: (name, callback) => hooks.register("permission", name, callback),
            list: () => Effect.die("unused permission.list"),
            get: () => Effect.die("unused permission.get"),
            reply: () => Effect.die("unused permission.reply"),
          },
        },
        (name, callback) => hooks.register("tool", name, callback),
      )
    }),
  ),
  deps: [Permission.node, Session.node, Tool.node, PluginHooks.node],
})

const it = testEffect(
  AppNodeBuilder.build(LayerNode.group([Database.node, Bus.node, Job.node, Session.node, LocationServiceMap.node]), [
    SessionExecution.node.replace(executionNode),
    Global.node.replace(tempGlobalLayer),
    offlineModels,
    PluginSupervisor.node.replace(companionPluginSupervisor),
  ]),
)

const withDirectory = <A, E, R>(body: (location: Location.Ref) => Effect.Effect<A, E, R>) =>
  Effect.acquireRelease(
    Effect.promise(() => tmpdir()),
    (dir) => Effect.promise(() => dir[Symbol.asyncDispose]()),
  ).pipe(Effect.flatMap((dir) => body(Location.Ref.make({ directory: AbsolutePath.make(dir.path) }))))

const registry = (location: Location.Ref) =>
  Effect.gen(function* () {
    const locations = yield* LocationServiceMap.Service
    yield* Plugin.Service.use((plugins) => plugins.awaitActivation).pipe(Effect.provide(locations.get(location)))
    return yield* Tool.Service.pipe(Effect.provide(locations.get(location)))
  })

const call = (name: string, input: Record<string, unknown>) => ({
  type: "tool-call" as const,
  id: `call-${name}`,
  name,
  input,
})

describe("CompanionTools", () => {
  it.live("gives each main session one companion", () =>
    withDirectory((location) =>
      Effect.gen(function* () {
        const sessions = yield* Session.Service
        const main = yield* sessions.create({ location, title: "Main" })
        const companion = yield* sessions.companion(main.id)
        expect(companion).toMatchObject({ parentID: main.id, kind: "companion", agent: "companion", permissions: [] })
        expect((yield* sessions.companion(main.id)).id).toBe(companion.id)
        expect((yield* sessions.companion(companion.id)).id).toBe(companion.id)
      }),
    ),
  )

  it.live("uses the companion agent's model before the main session's model", () =>
    withDirectory((location) =>
      Effect.gen(function* () {
        const sessions = yield* Session.Service
        const locations = yield* LocationServiceMap.Service
        const model = Model.Ref.make({ providerID: Provider.ID.make("main"), id: Model.ID.make("large") })
        const fast = Model.Ref.make({ providerID: Provider.ID.make("fast"), id: Model.ID.make("small") })

        const fallback = yield* sessions.companion((yield* sessions.create({ location, model })).id)
        expect(fallback.model).toMatchObject(model)

        yield* Agent.Service.use((agents) =>
          agents.transform((editor) =>
            editor.update(Agent.ID.make("companion"), (agent) => {
              agent.model = { ...fast }
            }),
          ),
        ).pipe(Effect.provide(locations.get(location)))
        const configured = yield* sessions.companion((yield* sessions.create({ location, model })).id)
        expect(configured.model).toMatchObject(fast)
      }),
    ),
  )

  it.live("denies what config rules would let the companion ask for or edit", () =>
    withDirectory((location) =>
      Effect.gen(function* () {
        const sessions = yield* Session.Service
        const locations = yield* LocationServiceMap.Service
        const main = yield* sessions.create({ location, agent: Agent.ID.make("reviewer") })
        const companion = yield* sessions.companion(main.id)
        yield* registry(location)
        const effects = yield* Effect.gen(function* () {
          const agents = yield* Agent.Service
          yield* agents.transform((editor) =>
            [Agent.ID.make("reviewer"), Agent.ID.make("companion")].forEach((id) =>
              editor.update(id, (agent) => {
                agent.permissions.push(
                  { action: "shell", resource: "*", effect: "ask" },
                  { action: "edit", resource: "*", effect: "allow" },
                )
              }),
            ),
          )
          const permission = yield* Permission.Service
          return yield* Effect.forEach([main, companion], (session) =>
            Effect.forEach(
              [
                { action: "shell", resources: ["npm test"] },
                { action: "edit", resources: ["src/index.ts"] },
              ],
              (input) =>
                permission
                  .ask({ sessionID: session.id, agent: session.agent, ...input })
                  .pipe(Effect.map((result) => result.effect)),
            ),
          )
        }).pipe(Effect.provide(locations.get(location)))

        expect(effects).toEqual([
          ["ask", "allow"],
          ["deny", "deny"],
        ])
      }),
    ),
  )

  it.live("steers the main session from its companion", () =>
    withDirectory((location) =>
      Effect.gen(function* () {
        const sessions = yield* Session.Service
        const main = yield* sessions.create({ location, title: "Main" })
        const companion = yield* sessions.companion(main.id)
        const tools = yield* registry(location)

        const sent = yield* executeTool(tools, {
          sessionID: companion.id,
          ...toolIdentity,
          call: call("main_send", { text: "Run the tests before committing", delivery: "queue" }),
        })
        expect(sent.status).toBe("completed")
        const inbox = yield* sessions.inbox(main.id)
        expect(inbox).toEqual([
          expect.objectContaining({
            type: "user",
            delivery: "queue",
            payload: expect.objectContaining({
              text: "Run the tests before committing",
              metadata: { source: "companion", companionID: companion.id },
            }),
          }),
        ])

        const status = yield* executeTool(tools, {
          sessionID: companion.id,
          ...toolIdentity,
          call: call("main_status", {}),
        })
        expect(status.content).toEqual([
          { type: "text", text: expect.stringContaining("Run the tests before committing") },
        ])

        const cancelled = yield* executeTool(tools, {
          sessionID: companion.id,
          ...toolIdentity,
          call: call("main_cancel", { inboxID: inbox[0]?.id }),
        })
        expect(cancelled.status).toBe("completed")
        expect(yield* sessions.inbox(main.id)).toEqual([])
      }),
    ),
  )

  it.live("limits companion shell commands to one read-only git command", () =>
    withDirectory((location) =>
      Effect.gen(function* () {
        const sessions = yield* Session.Service
        const companion = yield* sessions.companion((yield* sessions.create({ location })).id)
        const tools = yield* registry(location)
        const run = (agent: string, command: string) =>
          executeTool(tools, {
            sessionID: companion.id,
            ...toolIdentity,
            agent: Agent.ID.make(agent),
            call: call("shell", { command }),
          }).pipe(Effect.map((result) => result.error?.message))

        // Config rules such as `git *` allow these; the hook refuses them anyway.
        const refused = [
          "git status && git log > notes.txt",
          "git diff --output=patch.txt",
          "git commit -m x",
          "git reset --hard",
          "git branch -D main",
          "git status; touch notes.txt",
          "git log $(touch notes.txt)",
          "git show `touch notes.txt`",
          "git log | tee notes.txt",
          "git status\ntouch notes.txt",
          "gh pr comment 1 --body x",
        ]
        for (const command of refused)
          expect(yield* run("companion", command)).toBe(
            "The companion can only run one read-only git command, without shell operators",
          )
        // Allowed commands and other agents reach tool lookup; this registry has no shell tool.
        for (const command of ["git status", "git log --oneline -5 --format='%h %s'", "git branch -v", "git diff "])
          expect(yield* run("companion", command)).toContain('No tool named "shell"')
        expect(yield* run("build", "git log > notes.txt")).toContain('No tool named "shell"')
      }),
    ),
  )

  it.live("refuses callers that are not companions", () =>
    withDirectory((location) =>
      Effect.gen(function* () {
        const sessions = yield* Session.Service
        const main = yield* sessions.create({ location, title: "Main" })
        const tools = yield* registry(location)
        const result = yield* executeTool(tools, {
          sessionID: main.id,
          ...toolIdentity,
          call: call("main_send", { text: "hello" }),
        })
        expect(result).toMatchObject({
          status: "error",
          error: { message: expect.stringContaining("Only a companion session") },
        })
        expect(yield* sessions.inbox(main.id)).toEqual([])
      }),
    ),
  )
})
