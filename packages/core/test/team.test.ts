import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { AgentV2 } from "@opencode-ai/core/agent"
import { Database } from "@opencode-ai/core/database/database"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { EventV2 } from "@opencode-ai/core/event"
import { Location } from "@opencode-ai/core/location"
import { ModelV2 } from "@opencode-ai/core/model"
import { ProjectV2 } from "@opencode-ai/core/project"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { SessionV2 } from "@opencode-ai/core/session"
import { SessionExecution } from "@opencode-ai/core/session/execution"
import { SessionInputTable } from "@opencode-ai/core/session/sql"
import { SessionProjector } from "@opencode-ai/core/session/projector"
import { SessionStore } from "@opencode-ai/core/session/store"
import { AgentTeam } from "@opencode-ai/core/team"
import { AgentTeamTools } from "@opencode-ai/core/team/tools"
import { ApplicationTools } from "@opencode-ai/core/tool/application-tools"
import { Tool } from "@opencode-ai/core/tool/tool"
import { SessionMessage } from "@opencode-ai/core/session/message"
import { testEffect } from "./lib/effect"
import { eq } from "drizzle-orm"

const projects = Layer.succeed(
  ProjectV2.Service,
  ProjectV2.Service.of({
    resolve: (directory) => Effect.succeed({ id: ProjectV2.ID.global, directory }),
    directories: () => Effect.succeed([]),
    commit: () => Effect.void,
  }),
)
const it = testEffect(
  AppNodeBuilder.build(
    LayerNode.group([
      Database.node,
      EventV2.node,
      SessionProjector.node,
      SessionStore.node,
      SessionV2.node,
      AgentTeam.node,
      ApplicationTools.node,
      AgentTeamTools.node,
    ]),
    [
      [ProjectV2.node, projects],
      [SessionExecution.node, SessionExecution.noopLayer],
    ],
  ),
)
const location = Location.Ref.make({ directory: AbsolutePath.make("/project") })
const model = ModelV2.Ref.make({ id: ModelV2.ID.make("qwen"), providerID: ProviderV2.ID.make("local") })

describe("AgentTeam", () => {
  it.effect("registers native model-callable team tools", () =>
    Effect.gen(function* () {
      const tools = yield* ApplicationTools.Service
      expect([...tools.entries().keys()].sort()).toEqual([
        "team_create",
        "team_message",
        "team_spawn",
        "team_status",
        "team_task",
      ])
    }),
  )

  it.effect("executes native team creation and shared-task tools", () =>
    Effect.gen(function* () {
      const sessions = yield* SessionV2.Service
      const applications = yield* ApplicationTools.Service
      const lead = yield* sessions.create({ location, agent: AgentV2.ID.make("mark1"), model })
      const context: Tool.Context = {
        sessionID: lead.id,
        agent: AgentV2.ID.make("mark1"),
        assistantMessageID: SessionMessage.ID.make("msg_team_tools"),
        toolCallID: "call-team-tools",
      }
      const create = applications.entries().get("team_create")!.tool
      const created = yield* Tool.settle(
        create,
        { type: "tool-call", id: "call-create", name: "team_create", input: { name: "ProjectCombo" } },
        context,
      )
      expect(created.structured).toMatchObject({ name: "ProjectCombo", members: [{ name: "Mark1" }] })

      const task = applications.entries().get("team_task")!.tool
      const added = yield* Tool.settle(
        task,
        {
          type: "tool-call",
          id: "call-task",
          name: "team_task",
          input: { action: "create", title: "Review", description: "Review the implementation" },
        },
        context,
      )
      expect(added.structured).toMatchObject({ tasks: [{ title: "Review", status: "pending" }] })
    }),
  )

  it.effect("persists a team and its named members", () =>
    Effect.gen(function* () {
      const session = yield* SessionV2.Service
      const teams = yield* AgentTeam.Service
      const lead = yield* session.create({ location, agent: AgentV2.ID.make("mark1"), model })
      const reviewer = yield* session.create({ location, agent: AgentV2.ID.make("spencer2"), model })
      const team = yield* teams.create({ name: "ProjectCombo", leadSessionID: lead.id })

      yield* teams.addMember({
        teamID: team.id,
        member: {
          name: "Spencer2",
          sessionID: reviewer.id,
          agent: AgentV2.ID.make("spencer2"),
          model,
          role: "teammate",
          permission: "reviewer",
          status: "idle",
        },
      })

      expect(yield* teams.get(team.id)).toMatchObject({
        name: "ProjectCombo",
        leadSessionID: lead.id,
        members: [
          { name: "Mark1", permission: "lead", sessionID: lead.id },
          { name: "Spencer2", permission: "reviewer", sessionID: reviewer.id },
        ],
      })
      expect(yield* teams.forSession(reviewer.id)).toMatchObject({ id: team.id })
    }),
  )

  it.effect("persists and delivers named messages", () =>
    Effect.gen(function* () {
      const session = yield* SessionV2.Service
      const teams = yield* AgentTeam.Service
      const lead = yield* session.create({ location })
      const team = yield* teams.create({ name: "messages", leadSessionID: lead.id })
      const message = yield* teams.send({ teamID: team.id, from: "Spencer2", to: "Mark1", text: "Review ready" })

      expect(yield* teams.messages({ teamID: team.id, to: "Mark1", undelivered: true })).toMatchObject([
        { id: message.id, text: "Review ready", delivered: false },
      ])
      yield* teams.deliver(message.id)
      expect(yield* teams.messages({ teamID: team.id, to: "Mark1", undelivered: true })).toEqual([])
      expect(yield* teams.messages({ teamID: team.id })).toMatchObject([{ id: message.id, delivered: true }])
    }),
  )

  it.effect("spawns a persistent child session and admits work without waiting for completion", () =>
    Effect.gen(function* () {
      const session = yield* SessionV2.Service
      const teams = yield* AgentTeam.Service
      const db = (yield* Database.Service).db
      const lead = yield* session.create({ location, agent: AgentV2.ID.make("mark1"), model })
      const team = yield* teams.create({ name: "concurrent", leadSessionID: lead.id })

      const member = yield* teams.spawn({
        teamID: team.id,
        name: "Spencer2",
        agent: AgentV2.ID.make("spencer2"),
        model,
        permission: "reviewer",
        prompt: "Review the current change.",
      })

      expect(member).toMatchObject({ name: "Spencer2", status: "busy", permission: "reviewer" })
      expect(yield* session.get(member.sessionID)).toMatchObject({ parentID: lead.id, agent: "spencer2", model })
      expect(
        yield* db
          .select()
          .from(SessionInputTable)
          .where(eq(SessionInputTable.session_id, member.sessionID))
          .get()
          .pipe(Effect.orDie),
      ).toMatchObject({ prompt: { text: expect.stringContaining("Review the current change.") } })
    }),
  )

  it.effect("delivers a named message into the recipient session inbox", () =>
    Effect.gen(function* () {
      const session = yield* SessionV2.Service
      const teams = yield* AgentTeam.Service
      const db = (yield* Database.Service).db
      const lead = yield* session.create({ location, agent: AgentV2.ID.make("mark1"), model })
      const reviewer = yield* session.create({ location, agent: AgentV2.ID.make("spencer2"), model })
      const team = yield* teams.create({ name: "wake", leadSessionID: lead.id })
      yield* teams.addMember({
        teamID: team.id,
        member: {
          name: "Spencer2",
          sessionID: reviewer.id,
          agent: AgentV2.ID.make("spencer2"),
          model,
          role: "teammate",
          permission: "reviewer",
          status: "idle",
        },
      })

      const message = yield* teams.sendAndWake({
        teamID: team.id,
        from: "Mark1",
        to: "Spencer2",
        text: "The diff is ready.",
      })

      expect(message).toMatchObject({ delivered: true, from: "Mark1", to: "Spencer2" })
      expect(
        yield* db
          .select()
          .from(SessionInputTable)
          .where(eq(SessionInputTable.session_id, reviewer.id))
          .get()
          .pipe(Effect.orDie),
      ).toMatchObject({ prompt: { text: "[Team message from Mark1]\nThe diff is ready." } })
    }),
  )

  it.effect("allows only one concurrent claimant for a shared task", () =>
    Effect.gen(function* () {
      const session = yield* SessionV2.Service
      const teams = yield* AgentTeam.Service
      const lead = yield* session.create({ location })
      const team = yield* teams.create({ name: "tasks", leadSessionID: lead.id })
      const task = yield* teams.addTask({
        teamID: team.id,
        task: { title: "Review", description: "Inspect the diff", status: "pending", dependencies: [] },
      })
      const claims = yield* Effect.all(
        [
          teams.claimTask({ teamID: team.id, taskID: task.id, assignee: "Mark1" }),
          teams.claimTask({ teamID: team.id, taskID: task.id, assignee: "Spencer2" }),
        ],
        { concurrency: "unbounded" },
      )

      expect(claims.filter(Boolean)).toHaveLength(1)
      expect(yield* teams.tasks(team.id)).toMatchObject([{ id: task.id, status: "in_progress" }])
    }),
  )

  it.effect("marks active teammates interrupted during restart recovery", () =>
    Effect.gen(function* () {
      const session = yield* SessionV2.Service
      const teams = yield* AgentTeam.Service
      const lead = yield* session.create({ location })
      const team = yield* teams.create({ name: "recovery", leadSessionID: lead.id })
      yield* teams.addMember({
        teamID: team.id,
        member: {
          name: "Mark1",
          sessionID: lead.id,
          agent: AgentV2.ID.make("mark1"),
          model,
          role: "lead",
          permission: "writer",
          status: "busy",
        },
      })

      expect(yield* teams.recover).toBe(1)
      expect(yield* teams.get(team.id)).toMatchObject({
        members: [{ name: "Mark1", status: "interrupted", error: expect.stringContaining("restarted") }],
      })
      expect(yield* teams.recover).toBe(0)
    }),
  )
})
