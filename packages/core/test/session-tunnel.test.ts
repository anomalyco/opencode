import { describe, expect } from "bun:test"
import path from "path"
import { eq } from "drizzle-orm"
import { Effect, Layer, Schema, Stream } from "effect"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { Global } from "@opencode/util/global"
import { makeGlobalNode, makeLocationNode } from "@opencode/util/effect/app-node"
import { Database } from "@opencode/core/database/database"
import { Bus } from "@opencode/core/bus"
import { Config } from "@opencode/core/config"
import { Location } from "@opencode/core/location"
import { Agent } from "@opencode/core/agent"
import { Job } from "@opencode/core/job"
import { LocationServiceMap } from "@opencode/core/location-service-map"
import { Plugin } from "@opencode/core/plugin"
import { PluginHooks } from "@opencode/core/plugin/hooks"
import { PluginSupervisor } from "@opencode/core/plugin/supervisor"
import { Permission } from "@opencode/core/permission"
import { Session } from "@opencode/core/session"
import { SessionEvent } from "@opencode/core/session/event"
import { SessionExecution } from "@opencode/core/session/execution"
import { SessionMessage } from "@opencode/core/session/message"
import { SessionTunnel } from "@opencode/core/session/tunnel"
import { SessionTunnelTable } from "@opencode/core/session/sql"
import { Tool } from "@opencode/core/tool"
import { TunnelTool } from "@opencode/core/tool/plugin/tunnel"
import { AbsolutePath } from "@opencode/core/schema"
import { tmpdirScoped } from "./fixture/tmpdir"
import { tempGlobalLayer } from "./fixture/global"
import { offlineModels } from "./fixture/models"
import { testEffect } from "./lib/effect"
import { executeTool, registerToolPlugin, toolDefinitions, toolIdentity } from "./lib/tool"

// The wake call is the contract for an idle recipient; the global execution node is
// process-shared, so each test asserts on its own freshly created session ids.
const wakeLog: Session.ID[] = []
const executionLog = makeGlobalNode({
  service: SessionExecution.Service,
  layer: Layer.effect(
    SessionExecution.Service,
    Effect.succeed(
      SessionExecution.Service.of({
        active: Effect.succeed(new Set()),
        isActive: () => Effect.succeed(false),
        resume: () => Effect.void,
        wake: (sessionID) => Effect.sync(() => wakeLog.push(sessionID)),
        interrupt: () => Effect.succeed(false),
        awaitIdle: () => Effect.void,
      }),
    ),
  ),
  deps: [],
})

const tunnelPluginSupervisor = makeLocationNode({
  name: "test/tunnel-plugins",
  layer: Layer.effectDiscard(
    Effect.gen(function* () {
      const hooks = yield* PluginHooks.Service
      yield* registerToolPlugin(
        TunnelTool.Plugin,
        { event: { subscribe: () => Stream.never } },
        (name, callback) => hooks.register("tool", name, callback),
      )
    }),
  ),
  deps: [
    Agent.node,
    Bus.node,
    Config.node,
    Permission.node,
    Session.node,
    SessionTunnel.node,
    Tool.node,
    PluginHooks.node,
  ],
})

const nodes = LayerNode.group([
  Database.node,
  Bus.node,
  Job.node,
  Session.node,
  SessionExecution.node,
  LocationServiceMap.node,
  SessionTunnel.node,
])
const replacements = [
  SessionExecution.node.replace(executionLog),
  Global.node.replace(tempGlobalLayer),
  offlineModels,
] satisfies LayerNode.Replacements
const it = testEffect(
  AppNodeBuilder.build(nodes, [...replacements, PluginSupervisor.node.replace(tunnelPluginSupervisor)]),
)

const enableFlag = (dir: string) =>
  Effect.promise(() =>
    Bun.write(path.join(dir, "opencode.json"), JSON.stringify({ experimental: { agent_tunnel: true } })),
  )

const makeFamily = (sessions: Session.Interface, dir: string) =>
  Effect.gen(function* () {
    const location = Location.Ref.make({ directory: AbsolutePath.make(dir) })
    const root = yield* sessions.create({ location, title: "root" })
    const reviewer = yield* sessions.create({
      parentID: root.id,
      title: "review",
      agent: Agent.ID.make("reviewer"),
    })
    const writer = yield* sessions.create({ parentID: root.id, title: "write", agent: Agent.ID.make("writer") })
    const grandchild = yield* sessions.create({ parentID: reviewer.id, title: "deep review" })
    return { location, root, reviewer, writer, grandchild }
  })

/** The caller identity used by executeTool; tunnel permission asserts against its ruleset. */
const withPermissions = (location: Location.Ref, ...rules: Permission.Rule[]) =>
  Effect.gen(function* () {
    const locations = yield* LocationServiceMap.Service
    yield* Plugin.Service.use((plugins) => plugins.awaitActivation).pipe(Effect.provide(locations.get(location)))
    yield* Agent.Service.use((agents) =>
      agents.transform((editor) => {
        editor.update(toolIdentity.agent, (agent) => {
          agent.mode = "primary"
          agent.permissions.push({ action: "*", resource: "*", effect: "allow" }, ...rules)
        })
      }),
    ).pipe(Effect.provide(locations.get(location)))
  })

const callTunnel = (
  registry: Tool.Interface,
  sessionID: Session.ID,
  id: string,
  input: Record<string, unknown>,
) =>
  executeTool(registry, {
    sessionID,
    ...toolIdentity,
    call: { type: "tool-call", id, name: TunnelTool.name, input },
  })

const pendingSynthetic = (sessions: Session.Interface, sessionID: Session.ID) =>
  sessions.inbox(sessionID).pipe(
    Effect.map((items) => items.flatMap((item) => (item.type === "synthetic" ? [item] : []))),
  )

const tunnelRows = (messageID: SessionMessage.ID) =>
  Effect.gen(function* () {
    const database = yield* Database.Service
    return yield* database.db
      .select()
      .from(SessionTunnelTable)
      .where(eq(SessionTunnelTable.id, messageID))
      .all()
      .pipe(Effect.orDie)
  })

describe("SessionTunnel", () => {
  it.live("delivers a family message as a pending steer input and wakes an idle recipient", () =>
    tmpdirScoped().pipe(
      Effect.flatMap((dir) =>
        Effect.gen(function* () {
          const sessions = yield* Session.Service
          const tunnel = yield* SessionTunnel.Service
          const bus = yield* Bus.Service
          const family = yield* makeFamily(sessions, dir.path)
          const sent: Array<typeof SessionEvent.TunnelSent.Type> = []
          yield* bus.project(SessionEvent.TunnelSent, (event) => Effect.sync(() => sent.push(event)))

          const message = yield* tunnel.send({
            from: family.reviewer.id,
            to: family.writer.id,
            kind: "message",
            body: "please review the parser patch",
          })

          expect(message.from).toEqual({ sessionID: family.reviewer.id, agent: Agent.ID.make("reviewer") })
          expect(message.to).toEqual({ sessionID: family.writer.id, agent: Agent.ID.make("writer") })
          expect(message.body).toBe("please review the parser patch")

          const pending = yield* pendingSynthetic(sessions, family.writer.id)
          expect(pending).toHaveLength(1)
          expect(pending[0]?.id).toBe(message.id)
          expect(pending[0]?.delivery).toBe("steer")
          expect(pending[0]?.payload.text).toContain("From: session " + family.reviewer.id)
          expect(pending[0]?.payload.text).toContain("please review the parser patch")
          expect(pending[0]?.payload.metadata).toEqual({
            source: "tunnel",
            from: family.reviewer.id,
            kind: "message",
          })
          expect(wakeLog).toContain(family.writer.id)

          // One durable send on the recipient's aggregate; the projection stores the assigned seq.
          expect(sent).toHaveLength(1)
          const rows = yield* tunnelRows(message.id)
          expect(rows).toHaveLength(1)
          expect(rows[0]).toMatchObject({
            from_session_id: family.reviewer.id,
            to_session_id: family.writer.id,
            kind: "message",
            body: "please review the parser patch",
            sequence: sent[0]?.durable.seq,
          })
          expect((yield* tunnel.list({ sessionID: family.reviewer.id })).map((item) => item.id)).toEqual([
            message.id,
          ])
        }),
      ),
    ),
  )

  it.live("rejects targets outside the family, self-sends, and reports to non-ancestors", () =>
    tmpdirScoped().pipe(
      Effect.flatMap((dir) =>
        Effect.gen(function* () {
          const sessions = yield* Session.Service
          const tunnel = yield* SessionTunnel.Service
          const family = yield* makeFamily(sessions, dir.path)
          const stranger = yield* sessions.create({
            location: Location.Ref.make({ directory: AbsolutePath.make(dir.path) }),
            title: "unrelated",
          })
          const missing = Session.ID.create()

          expect(
            yield* Effect.flip(
              tunnel.send({ from: family.reviewer.id, to: stranger.id, kind: "message", body: "hi" }),
            ),
          ).toBeInstanceOf(SessionTunnel.NotInFamilyError)
          expect(
            yield* Effect.flip(
              tunnel.send({ from: family.reviewer.id, to: family.reviewer.id, kind: "message", body: "hi" }),
            ),
          ).toBeInstanceOf(SessionTunnel.NotInFamilyError)
          expect(
            yield* Effect.flip(tunnel.send({ from: family.reviewer.id, to: missing, kind: "message", body: "hi" })),
          ).toBeInstanceOf(Session.NotFoundError)
          // Reports climb the parent chain only.
          expect(
            yield* Effect.flip(
              tunnel.send({ from: family.reviewer.id, to: family.writer.id, kind: "report", body: "hi" }),
            ),
          ).toBeInstanceOf(SessionTunnel.ReportTargetError)
          // The whole family, in any direction, may exchange peer messages.
          const report = yield* tunnel.send({
            from: family.grandchild.id,
            to: family.root.id,
            kind: "report",
            body: "deep work done",
          })
          expect(report.kind).toBe("report")
          const peers = yield* tunnel.send({
            from: family.grandchild.id,
            to: family.writer.id,
            kind: "message",
            body: "aunt message",
          })
          expect(peers.kind).toBe("message")
          expect((yield* tunnel.family(family.grandchild.id)).map((member) => member.id).sort()).toEqual(
            [family.root.id, family.reviewer.id, family.grandchild.id, family.writer.id].sort(),
          )
        }),
      ),
    ),
  )

  it.live("reuses an admitted id on resend and rejects cross-recipient id reuse", () =>
    tmpdirScoped().pipe(
      Effect.flatMap((dir) =>
        Effect.gen(function* () {
          const sessions = yield* Session.Service
          const tunnel = yield* SessionTunnel.Service
          const family = yield* makeFamily(sessions, dir.path)
          const id = SessionMessage.ID.create()

          const first = yield* tunnel.send({
            from: family.reviewer.id,
            to: family.writer.id,
            kind: "message",
            body: "once",
            id,
          })
          const second = yield* tunnel.send({
            from: family.reviewer.id,
            to: family.writer.id,
            kind: "message",
            body: "retry",
            id,
          })
          // First admission wins: the retried payload is ignored.
          expect(second).toEqual(first)
          const rows = yield* tunnelRows(id)
          expect(rows).toHaveLength(1)
          expect(rows[0]?.body).toBe("once")
          expect(yield* pendingSynthetic(sessions, family.writer.id)).toHaveLength(1)

          expect(
            yield* Effect.flip(
              tunnel.send({ from: family.writer.id, to: family.reviewer.id, kind: "message", body: "reuse", id }),
            ),
          ).toBeInstanceOf(SessionTunnel.ConflictError)
        }),
      ),
    ),
  )

  it.live("lists family messages in send order and honors the after cursor", () =>
    tmpdirScoped().pipe(
      Effect.flatMap((dir) =>
        Effect.gen(function* () {
          const sessions = yield* Session.Service
          const tunnel = yield* SessionTunnel.Service
          const family = yield* makeFamily(sessions, dir.path)

          // All three land on the same recipient, so their sequences ascend together.
          const first = yield* tunnel.send({
            from: family.reviewer.id,
            to: family.writer.id,
            kind: "message",
            body: "one",
          })
          yield* tunnel.send({ from: family.reviewer.id, to: family.writer.id, kind: "message", body: "two" })
          yield* tunnel.send({ from: family.root.id, to: family.writer.id, kind: "message", body: "three" })

          const fromChild = yield* tunnel.list({ sessionID: family.reviewer.id })
          expect(fromChild.map((item) => item.body)).toEqual(["one", "two", "three"])
          // Any family member sees the same set.
          const fromRoot = yield* tunnel.list({ sessionID: family.root.id })
          expect(fromRoot.map((item) => item.body)).toEqual(["one", "two", "three"])
          const afterFirst = yield* tunnel.list({ sessionID: family.writer.id, after: first.sequence })
          expect(afterFirst.map((item) => item.body)).toEqual(["two", "three"])
        }),
      ),
    ),
  )
})

describe("TunnelTool", () => {
  it.live("is absent while the agent_tunnel flag is off", () =>
    tmpdirScoped().pipe(
      Effect.flatMap((dir) =>
        Effect.gen(function* () {
          const sessions = yield* Session.Service
          const family = yield* makeFamily(sessions, dir.path)
          yield* withPermissions(family.location)
          const locations = yield* LocationServiceMap.Service
          const registry = yield* Tool.Service.pipe(Effect.provide(locations.get(family.location)))

          expect((yield* toolDefinitions(registry)).map((tool) => tool.name)).not.toContain(TunnelTool.name)
          expect(yield* sessions.inbox(family.writer.id)).toHaveLength(0)
        }),
      ),
    ),
  )

  it.live("sends peer messages and parent reports through the tool", () =>
    tmpdirScoped().pipe(
      Effect.flatMap((dir) =>
        Effect.gen(function* () {
          yield* enableFlag(dir.path)
          const sessions = yield* Session.Service
          const family = yield* makeFamily(sessions, dir.path)
          yield* withPermissions(family.location)
          const locations = yield* LocationServiceMap.Service
          const registry = yield* Tool.Service.pipe(Effect.provide(locations.get(family.location)))

          const sent = yield* callTunnel(registry, family.reviewer.id, "call-tunnel-peer", {
            to: family.writer.id,
            body: "review the parser patch",
          })
          expect(sent).toMatchObject({
            status: "completed",
            output: { to: family.writer.id, kind: "message", status: "sent" },
            metadata: { to: family.writer.id, kind: "message" },
          })
          const peer = yield* pendingSynthetic(sessions, family.writer.id)
          expect(peer).toHaveLength(1)
          const messageID = Schema.decodeUnknownSync(Schema.Struct({ id: SessionMessage.ID }))(sent.output).id
          expect(peer[0]?.id).toBe(messageID)
          expect(peer[0]?.payload.text).toContain("review the parser patch")
          expect(wakeLog).toContain(family.writer.id)

          // Omitting `to` reports to the direct parent.
          const reported = yield* callTunnel(registry, family.reviewer.id, "call-tunnel-report", {
            body: "finished the review",
          })
          expect(reported).toMatchObject({
            status: "completed",
            output: { to: family.root.id, kind: "report", status: "sent" },
            metadata: { to: family.root.id, kind: "report" },
          })
          const toParent = yield* pendingSynthetic(sessions, family.root.id)
          expect(toParent).toHaveLength(1)
          expect(toParent[0]?.payload.text).toContain("finished the review")
        }),
      ),
    ),
  )

  it.live("requires a target or a parent to report to", () =>
    tmpdirScoped().pipe(
      Effect.flatMap((dir) =>
        Effect.gen(function* () {
          yield* enableFlag(dir.path)
          const sessions = yield* Session.Service
          const family = yield* makeFamily(sessions, dir.path)
          yield* withPermissions(family.location)
          const locations = yield* LocationServiceMap.Service
          const registry = yield* Tool.Service.pipe(Effect.provide(locations.get(family.location)))

          // A root session has no parent to report to.
          expect(
            yield* callTunnel(registry, family.root.id, "call-tunnel-orphan", { body: "nowhere to go" }),
          ).toEqual({
            status: "error",
            error: {
              type: "tool.execution",
              message: expect.stringContaining("no parent session to report to"),
            },
          })
          // A message without `to` is a report, so an explicit target is still required for peers.
          expect(
            yield* callTunnel(registry, family.reviewer.id, "call-tunnel-targetless", {
              kind: "message",
              body: "to whom?",
            }),
          ).toEqual({
            status: "error",
            error: {
              type: "tool.execution",
              message: expect.stringContaining("requires the target session"),
            },
          })
          expect(yield* sessions.inbox(family.root.id)).toHaveLength(0)
        }),
      ),
    ),
  )

  it.live("enforces per-agent permission rules on the target", () =>
    tmpdirScoped().pipe(
      Effect.flatMap((dir) =>
        Effect.gen(function* () {
          yield* enableFlag(dir.path)
          const sessions = yield* Session.Service
          const family = yield* makeFamily(sessions, dir.path)
          yield* withPermissions(family.location, { action: "tunnel", resource: "reviewer", effect: "deny" })
          const locations = yield* LocationServiceMap.Service
          const registry = yield* Tool.Service.pipe(Effect.provide(locations.get(family.location)))

          // The canonical session error surfaces the permission block itself, not the wrapper message.
          expect(
            yield* callTunnel(registry, family.root.id, "call-tunnel-denied", {
              to: family.reviewer.id,
              body: "blocked",
            }),
          ).toEqual({
            status: "error",
            error: { type: "permission.rejected", message: "Permission denied: tunnel" },
          })
          expect(yield* sessions.inbox(family.reviewer.id)).toHaveLength(0)

          const allowed = yield* callTunnel(registry, family.root.id, "call-tunnel-allowed", {
            to: family.writer.id,
            body: "welcome",
          })
          expect(allowed).toMatchObject({ status: "completed", metadata: { to: family.writer.id, kind: "message" } })
          expect(yield* pendingSynthetic(sessions, family.writer.id)).toHaveLength(1)
        }),
      ),
    ),
  )
})
