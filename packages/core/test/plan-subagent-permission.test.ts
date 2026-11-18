import { describe, expect } from "bun:test"
import path from "path"
import { Cause, Effect, Exit } from "effect"
import { Agent } from "@opencode/core/agent"
import { Bus } from "@opencode/core/bus"
import { Database } from "@opencode/core/database/database"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { Watcher } from "@opencode/core/filesystem/watcher"
import { Location } from "@opencode/core/location"
import { LocationServiceMap } from "@opencode/core/location-service-map"
import { Permission } from "@opencode/core/permission"
import { Project } from "@opencode/core/project"
import { Plugin } from "@opencode/core/plugin"
import { AbsolutePath } from "@opencode/core/schema"
import { Session } from "@opencode/core/session"
import { SessionExecution } from "@opencode/core/session/execution"
import { SessionMessage } from "@opencode/core/session/message"
import { SessionProjector } from "@opencode/core/session/projector"
import { SessionStore } from "@opencode/core/session/store"
import { Tool } from "@opencode/core/tool"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { Global } from "@opencode/util/global"
import { tempGlobalLayer } from "./fixture/global"
import { offlineModels } from "./fixture/models"
import { promptLocationNode } from "./fixture/prompt-location"
import { tmpdirScoped } from "./fixture/tmpdir"
import { testEffect } from "./lib/effect"
import { executeTool } from "./lib/tool"
import { globalProjectNode } from "./lib/project"

const plan = Agent.ID.make("plan")
const general = Agent.ID.make("general")
const helper = Agent.ID.make("helper")
const locked = Agent.ID.make("locked")
const guard = Agent.ID.make("guard")
const outside = "src/app.ts"
const granted = "/granted/file.ts"

const location = Location.Ref.make({ directory: AbsolutePath.make("/project") })
const allowAll: Permission.Ruleset = [{ action: "*", resource: "*", effect: "allow" }]

const absent = testEffect(
  AppNodeBuilder.build(
    LayerNode.group([Database.node, Bus.node, SessionProjector.node, SessionStore.node, Session.node]),
    [
      Bus.node.replace(Bus.configured({ persist: true })),
      Project.node.replace(globalProjectNode),
      LocationServiceMap.node.replace(promptLocationNode),
      SessionExecution.node.replace(SessionExecution.noopLayer),
    ],
  ),
)

const it = testEffect(
  AppNodeBuilder.build(LayerNode.group([Session.node, LocationServiceMap.node]), [
    Global.node.replace(tempGlobalLayer),
    offlineModels,
    Watcher.node.replace(Watcher.configured({ enabled: false })),
    SessionExecution.node.replace(SessionExecution.noopLayer),
  ]),
)

const expectDenied = (
  permission: Permission.Interface,
  input: { sessionID: Session.ID; agent?: Agent.ID; action: string; resources: string[] },
) =>
  Effect.gen(function* () {
    const exit = yield* permission.assertNotDenied(input).pipe(Effect.exit)
    const error = Exit.isFailure(exit) ? Cause.squash(exit.cause) : exit
    expect(error).toBeInstanceOf(Permission.BlockedError)
    expect(error).toMatchObject({ permission: input.action, resources: input.resources })
  })

describe("child sessions inherit parent agent denies", () => {
  it.live("keeps plan children from editing, including after reuse and an agent switch", () =>
    Effect.gen(function* () {
      const tmp = yield* tmpdirScoped()
      const sessions = yield* Session.Service
      const parent = yield* sessions.create({
        location: { directory: AbsolutePath.make(tmp.path) },
        agent: plan,
      })
      expect(parent.permissions).toBeUndefined()
      const locations = yield* LocationServiceMap.Service
      const provide = locations.get(parent.location)
      yield* Plugin.Service.use((plugins) => plugins.awaitActivation).pipe(Effect.provide(provide))
      const agents = yield* Agent.Service.pipe(Effect.provide(provide))
      const permission = yield* Permission.Service.pipe(Effect.provide(provide))
      const tools = yield* Tool.Service.pipe(Effect.provide(provide))
      const planAgent = yield* agents.get(plan)
      const planFile = planAgent?.permissions.findLast((rule) => rule.action === "edit" && rule.effect === "allow")
      if (!planFile) return yield* Effect.die("Plan agent did not allow its plan directory")
      const inside = planFile.resource.replace(/\*$/, "note.md")

      yield* agents.transform((editor) => {
        editor.update(helper, (agent) => {
          agent.mode = "subagent"
          agent.description = "Custom subagent"
        })
        editor.update(locked, (agent) => {
          agent.mode = "subagent"
          agent.permissions.push(
            { action: "*", resource: "*", effect: "deny" },
            { action: "read", resource: "*", effect: "allow" },
          )
        })
      })

      yield* expectDenied(permission, { sessionID: parent.id, agent: plan, action: "edit", resources: [outside] })
      expect(yield* permission.allows({ sessionID: parent.id, agent: plan, action: "edit", resources: [inside] })).toBe(
        true,
      )

      const child = yield* sessions.create({ parentID: parent.id, agent: general, title: "general" })
      const custom = yield* sessions.create({ parentID: parent.id, agent: helper, title: "helper" })
      const readOnly = yield* sessions.create({ parentID: parent.id, agent: locked, title: "locked" })

      const editing = ["edit", "write", "patch"]
      for (const session of [child, custom]) {
        yield* expectDenied(permission, {
          sessionID: session.id,
          agent: session.agent,
          action: "edit",
          resources: [outside],
        })
        yield* expectDenied(permission, {
          sessionID: session.id,
          agent: session.agent,
          action: "edit",
          resources: [inside],
        })
        const info = yield* agents.get(session.agent ?? general)
        if (!info) return yield* Effect.die(`Missing child agent: ${session.agent}`)
        const names = (yield* tools.snapshot(
          Permission.merge(info.permissions, session.permissions ?? []),
        )).definitions.map((tool) => tool.name)
        expect(names.includes("read")).toBe(true)
        for (const name of editing) expect(names.includes(name)).toBe(false)
      }

      yield* expectDenied(permission, {
        sessionID: readOnly.id,
        agent: locked,
        action: "edit",
        resources: [inside],
      })
      expect(
        yield* permission.allows({ sessionID: readOnly.id, agent: locked, action: "read", resources: ["README.md"] }),
      ).toBe(true)

      const resumed = yield* sessions.create({ id: child.id, parentID: parent.id, permissions: [], agent: helper })
      expect(resumed.id).toBe(child.id)
      yield* sessions.switchAgent({ sessionID: child.id, agent: helper })
      yield* expectDenied(permission, { sessionID: child.id, action: "edit", resources: [outside] })
      yield* expectDenied(permission, {
        sessionID: child.id,
        agent: helper,
        action: "edit",
        resources: [path.join(tmp.path, "src", "app.ts")],
      })
    }),
  )

  it.live("forwards a non-plan deny without dropping session restrictions or copying parent allows", () =>
    Effect.gen(function* () {
      const tmp = yield* tmpdirScoped()
      const sessions = yield* Session.Service
      const parent = yield* sessions.create({
        location: { directory: AbsolutePath.make(tmp.path) },
        agent: guard,
        permissions: [
          { action: "external_directory", resource: "/outside/*", effect: "deny" },
          { action: "read", resource: "secrets/*", effect: "deny" },
        ],
      })
      const locations = yield* LocationServiceMap.Service
      const provide = locations.get(parent.location)
      yield* Plugin.Service.use((plugins) => plugins.awaitActivation).pipe(Effect.provide(provide))
      const agents = yield* Agent.Service.pipe(Effect.provide(provide))
      const permission = yield* Permission.Service.pipe(Effect.provide(provide))
      yield* agents.transform((editor) => {
        editor.update(guard, (agent) => {
          agent.mode = "primary"
          agent.permissions.push(
            { action: "edit", resource: "/granted/*", effect: "allow" },
            { action: "shell", resource: "*", effect: "deny" },
          )
        })
        editor.update(locked, (agent) => {
          agent.mode = "subagent"
          agent.permissions.push(
            { action: "*", resource: "*", effect: "deny" },
            { action: "read", resource: "*", effect: "allow" },
          )
        })
      })

      const child = yield* sessions.create({ parentID: parent.id, agent: general, title: "general" })
      const readOnly = yield* sessions.create({ parentID: parent.id, agent: locked, title: "locked" })

      yield* expectDenied(permission, { sessionID: child.id, agent: general, action: "shell", resources: ["*"] })
      yield* expectDenied(permission, {
        sessionID: child.id,
        agent: general,
        action: "external_directory",
        resources: ["/outside/file"],
      })
      yield* expectDenied(permission, {
        sessionID: child.id,
        agent: general,
        action: "read",
        resources: ["secrets/key"],
      })
      expect(
        yield* permission.allows({ sessionID: child.id, agent: general, action: "edit", resources: [outside] }),
      ).toBe(true)

      yield* expectDenied(permission, { sessionID: readOnly.id, agent: locked, action: "shell", resources: ["*"] })
      yield* expectDenied(permission, { sessionID: readOnly.id, agent: locked, action: "edit", resources: [granted] })
      yield* expectDenied(permission, {
        sessionID: readOnly.id,
        agent: locked,
        action: "read",
        resources: ["secrets/key"],
      })
      yield* expectDenied(permission, {
        sessionID: readOnly.id,
        agent: locked,
        action: "external_directory",
        resources: ["/outside/file"],
      })
      expect(
        yield* permission.allows({ sessionID: readOnly.id, agent: locked, action: "read", resources: ["README.md"] }),
      ).toBe(true)
    }),
  )

  it.live("keeps a child from moving its session past a parent agent's external_directory deny", () =>
    Effect.gen(function* () {
      const tmp = yield* tmpdirScoped()
      const elsewhere = yield* tmpdirScoped()
      const sessions = yield* Session.Service
      const parent = yield* sessions.create({ location: { directory: AbsolutePath.make(tmp.path) }, agent: guard })
      const locations = yield* LocationServiceMap.Service
      const provide = locations.get(parent.location)
      yield* Plugin.Service.use((plugins) => plugins.awaitActivation).pipe(Effect.provide(provide))
      const agents = yield* Agent.Service.pipe(Effect.provide(provide))
      const tools = yield* Tool.Service.pipe(Effect.provide(provide))
      yield* agents.transform((editor) => {
        editor.update(guard, (agent) => {
          agent.mode = "primary"
          agent.permissions.push({ action: "external_directory", resource: "*", effect: "deny" })
        })
      })

      const child = yield* sessions.create({ parentID: parent.id, agent: general, title: "general" })
      const moved = yield* executeTool(tools, {
        sessionID: child.id,
        agent: general,
        messageID: SessionMessage.ID.create(),
        call: {
          type: "tool-call",
          id: "call-move-out",
          name: "execute",
          input: { code: `return await tools.shuvcode.session_move(${JSON.stringify({ directory: elsewhere.path })})` },
        },
      })
      expect(moved).toMatchObject({ metadata: { error: true } })
      expect((yield* sessions.get(child.id)).location.directory).toBe(AbsolutePath.make(tmp.path))
      expect(yield* sessions.inbox(child.id)).toEqual([])
    }),
  )

  it.live("denies a child whose parent agent is not in the registry and leaves an agentless parent unchanged", () =>
    Effect.gen(function* () {
      const tmp = yield* tmpdirScoped()
      const directory = { directory: AbsolutePath.make(tmp.path) }
      const sessions = yield* Session.Service
      const plain = yield* sessions.create({
        location: directory,
        permissions: [{ action: "read", resource: "secrets/*", effect: "deny" }],
      })
      const plainChild = yield* sessions.create({ parentID: plain.id, agent: general, title: "agentless" })
      const missing = yield* sessions.create({
        location: directory,
        agent: Agent.ID.make("missing-parent"),
      })
      const child = yield* sessions.create({ parentID: missing.id, agent: general, title: "missing" })
      const locations = yield* LocationServiceMap.Service
      const permission = yield* Permission.Service.pipe(Effect.provide(locations.get(plain.location)))
      yield* Plugin.Service.use((plugins) => plugins.awaitActivation).pipe(
        Effect.provide(locations.get(plain.location)),
      )

      expect(
        yield* permission.allows({ sessionID: plainChild.id, agent: general, action: "edit", resources: [outside] }),
      ).toBe(true)
      yield* expectDenied(permission, {
        sessionID: plainChild.id,
        agent: general,
        action: "read",
        resources: ["secrets/key"],
      })
      yield* expectDenied(permission, { sessionID: child.id, agent: general, action: "edit", resources: [outside] })
      yield* expectDenied(permission, { sessionID: child.id, agent: general, action: "read", resources: ["README.md"] })
    }),
  )

  absent.effect("denies a child when the parent location has no agent service", () =>
    Effect.gen(function* () {
      const sessions = yield* Session.Service
      const named = yield* sessions.create({ location, agent: Agent.ID.make("plan") })
      const child = yield* sessions.create({ parentID: named.id, agent: general })
      const plain = yield* sessions.create({ location })
      const plainChild = yield* sessions.create({ parentID: plain.id, agent: general })

      expect(Permission.evaluate("edit", outside, allowAll, child.permissions ?? []).effect).toBe("deny")
      expect(Permission.evaluate("read", "README.md", allowAll, child.permissions ?? []).effect).toBe("deny")
      expect(Permission.evaluate("edit", outside, allowAll, plainChild.permissions ?? []).effect).toBe("allow")
    }),
  )
})
