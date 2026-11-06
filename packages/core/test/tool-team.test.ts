import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { AbsolutePath } from "@opencode/core/schema"
import { Bus } from "@opencode/core/bus"
import { Database } from "@opencode/core/database/database"
import { Job } from "@opencode/core/job"
import { Location } from "@opencode/core/location"
import { LocationServiceMap } from "@opencode/core/location-service-map"
import { Agent } from "@opencode/core/agent"
import { Config } from "@opencode/core/config"
import { Permission } from "@opencode/core/permission"
import { Session } from "@opencode/core/session"
import { SessionExecution } from "@opencode/core/session/execution"
import { SessionTeam } from "@opencode/core/session/team"
import { makeGlobalNode, makeLocationNode } from "@opencode/util/effect/app-node"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { Global } from "@opencode/util/global"
import { PluginSupervisor } from "@opencode/core/plugin/supervisor"
import { Plugin } from "@opencode/core/plugin"
import { SessionStore } from "@opencode/core/session/store"
import { SubagentJob } from "@opencode/core/session/subagent-job"
import { SubagentTool } from "@opencode/core/tool/plugin/subagent"
import { TeamTool } from "@opencode/core/tool/plugin/team"
import { Tool } from "@opencode/core/tool"
import { tmpdirScoped } from "./fixture/tmpdir"
import { tempGlobalLayer } from "./fixture/global"
import { testEffect } from "./lib/effect"
import { executeTool, registerToolPlugin, toolIdentity } from "./lib/tool"

const executionNode = makeGlobalNode({
  service: SessionExecution.Service,
  layer: Layer.effect(
    SessionExecution.Service,
    Effect.succeed(
      SessionExecution.Service.of({
        active: Effect.succeed(new Set()),
        isActive: () => Effect.succeed(false),
        resume: () => Effect.void,
        wake: () => Effect.void,
        interrupt: () => Effect.succeed(false),
        awaitIdle: () => Effect.void,
      }),
    ),
  ),
  deps: [Bus.node, SessionStore.node],
})

const teamPluginSupervisor = makeLocationNode({
  name: "test/team-plugins",
  layer: Layer.effectDiscard(
    Effect.gen(function* () {
      yield* registerToolPlugin(SubagentTool.Plugin)
      yield* registerToolPlugin(TeamTool.Plugin)
    }),
  ),
  deps: [Agent.node, Config.node, Permission.node, Session.node, SessionTeam.node, Job.node, SubagentJob.node, Tool.node],
})

const nodes = LayerNode.group([
  Database.node,
  Bus.node,
  Job.node,
  Session.node,
  SessionTeam.node,
  SessionExecution.node,
  LocationServiceMap.node,
])

const it = testEffect(
  AppNodeBuilder.build(nodes, [
    SessionExecution.node.replace(executionNode),
    Global.node.replace(tempGlobalLayer),
    PluginSupervisor.node.replace(teamPluginSupervisor),
  ]),
)

const text = (settled: { content?: ReadonlyArray<Tool.Content> }) =>
  (settled.content ?? []).map((part) => (part.type === "text" ? part.text : "")).join("\n")

const inboxTexts = (sessions: Session.Interface, sessionID: Session.ID) =>
  Effect.gen(function* () {
    return (yield* sessions.inbox(sessionID)).filter((item) => item.type === "user").map((item) => item.payload.text)
  })

describe("TeamTool", () => {
  it.live("delivers peer messages between team members and the boss", () =>
    tmpdirScoped().pipe(
      Effect.flatMap((dir) =>
        Effect.gen(function* () {
          const location = Location.Ref.make({ directory: AbsolutePath.make(dir.path) })
          const sessions = yield* Session.Service
          const team = yield* SessionTeam.Service
          const parent = yield* sessions.create({ location, title: "boss" })
          const leader = yield* sessions.create({ parentID: parent.id, title: "leader" })
          const member = yield* sessions.create({ parentID: parent.id, title: "member" })
          yield* team.register({ parentID: parent.id, teamID: "survey", sessionID: leader.id })
          yield* team.register({ parentID: parent.id, teamID: "survey", sessionID: member.id })
          const locations = yield* LocationServiceMap.Service
          const registry = yield* Tool.Service.pipe(Effect.provide(locations.get(location)))
          yield* Plugin.Service.use((plugins) => plugins.awaitActivation).pipe(Effect.provide(locations.get(location)))

          const call = (sessionID: Session.ID, id: string, input: Record<string, unknown>) =>
            executeTool(registry, {
              sessionID,
              ...toolIdentity,
              call: { type: "tool-call" as const, id, name: "message_to_peer", input },
            })

          const toMember = yield* call(leader.id, "call-leader-to-member", { to: "survey-2", text: "status?" })
          expect(toMember.status).toBe("completed")
          expect(text(toMember)).toContain("Message sent to survey-2.")
          expect(yield* inboxTexts(sessions, member.id)).toEqual(["From survey-1 (leader):\nstatus?"])

          const toLeader = yield* call(member.id, "call-member-to-leader", { to: "survey-1", text: "done" })
          expect(toLeader.status).toBe("completed")
          expect(yield* inboxTexts(sessions, leader.id)).toEqual(["From survey-2 (member):\ndone"])

          const toBoss = yield* call(leader.id, "call-leader-to-boss", { to: "Boss", text: "report" })
          expect(toBoss.status).toBe("completed")
          expect(yield* inboxTexts(sessions, parent.id)).toEqual(["From survey-1 (leader):\nreport"])

          const memberToBoss = yield* call(member.id, "call-member-to-boss", { to: "Boss", text: "hi" })
          expect(memberToBoss).toEqual({
            status: "error",
            error: { type: "tool.execution", message: expect.stringContaining('No roster entry named "Boss"') },
          })

          const fromBoss = yield* call(parent.id, "call-boss-to-member", { to: "survey-2", text: "keep going" })
          expect(fromBoss.status).toBe("completed")
          expect(yield* inboxTexts(sessions, member.id)).toEqual([
            "From survey-1 (leader):\nstatus?",
            "From Boss:\nkeep going",
          ])

          const unknown = yield* call(leader.id, "call-unknown-peer", { to: "Nobody", text: "hello" })
          expect(unknown).toEqual({
            status: "error",
            error: { type: "tool.execution", message: expect.stringContaining('No roster entry named "Nobody"') },
          })
          expect(unknown.error?.message).toContain("- survey-2 (member)")
        }),
      ),
    ),
  )

  it.live("renders the team roster per role and rejects non-participants", () =>
    tmpdirScoped().pipe(
      Effect.flatMap((dir) =>
        Effect.gen(function* () {
          const location = Location.Ref.make({ directory: AbsolutePath.make(dir.path) })
          const sessions = yield* Session.Service
          const team = yield* SessionTeam.Service
          const parent = yield* sessions.create({ location, title: "boss" })
          const leader = yield* sessions.create({ parentID: parent.id, title: "leader" })
          const member = yield* sessions.create({ parentID: parent.id, title: "member" })
          const outsider = yield* sessions.create({ location, title: "outsider" })
          yield* team.register({ parentID: parent.id, teamID: "survey", sessionID: leader.id })
          yield* team.register({ parentID: parent.id, teamID: "survey", sessionID: member.id })
          const locations = yield* LocationServiceMap.Service
          const registry = yield* Tool.Service.pipe(Effect.provide(locations.get(location)))
          yield* Plugin.Service.use((plugins) => plugins.awaitActivation).pipe(Effect.provide(locations.get(location)))

          const roster = (sessionID: Session.ID, id: string) =>
            executeTool(registry, {
              sessionID,
              ...toolIdentity,
              call: { type: "tool-call" as const, id, name: "team_roster", input: {} },
            })

          const memberRoster = yield* roster(member.id, "call-member-roster")
          const memberLines = text(memberRoster)
          expect(memberLines).toContain("Team survey:")
          expect(memberLines).toContain("- survey-1 (leader) — the only member who can message Boss")
          expect(memberLines).toContain("- survey-2 (member) — you")
          expect(memberLines).not.toContain("your manager")

          const leaderRoster = yield* roster(leader.id, "call-leader-roster")
          const leaderLines = text(leaderRoster)
          expect(leaderLines).toContain("- survey-1 (leader) — the only member who can message Boss — you")
          expect(leaderLines).toContain("- Boss — your manager; only you (the leader) can message it")

          const bossRoster = yield* roster(parent.id, "call-boss-roster")
          const bossLines = text(bossRoster)
          expect(bossLines).toContain("Team survey:")
          expect(bossLines).toContain("- survey-1 (leader)")
          expect(bossLines).toContain("- survey-2 (member)")
          expect(bossLines).not.toContain("— you")

          const outsiderRoster = yield* roster(outsider.id, "call-outsider-roster")
          expect(outsiderRoster).toEqual({
            status: "error",
            error: {
              type: "tool.execution",
              message: expect.stringContaining("team_roster is only available to members of a team"),
            },
          })
        }),
      ),
    ),
  )
})
