import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { Agent } from "@opencode/core/agent"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { Database } from "@opencode/core/database/database"
import { InstructionBuiltIns } from "@opencode/core/instructions/builtins"
import { InstructionDiscovery } from "@opencode/core/instruction-discovery"
import { Instructions } from "@opencode/core/instructions/index"
import { Location } from "@opencode/core/location"
import { McpInstructions } from "@opencode/core/mcp/instructions"
import { McpTool } from "@opencode/core/tool/mcp"
import { Permission } from "@opencode/core/permission"
import { Project } from "@opencode/core/project"
import { ReferenceInstructions } from "@opencode/core/reference/instructions"
import { AbsolutePath } from "@opencode/core/schema"
import { SessionContext } from "@opencode/core/session/context"
import { SessionSchema } from "@opencode/core/session/schema"
import { SessionTable } from "@opencode/core/session/sql"
import { SessionStore } from "@opencode/core/session/store"
import { SessionRunnerModel } from "@opencode/core/session/runner/model"
import { SkillInstructions } from "@opencode/core/skill/instructions"
import { Tool } from "@opencode/core/tool"
import { testEffect } from "./lib/effect"

const received: Record<"tools" | "skills" | "mcp", Permission.Ruleset | undefined> = {
  tools: undefined,
  skills: undefined,
  mcp: undefined,
}

const it = testEffect(
  AppNodeBuilder.build(
    LayerNode.group([Database.node, Project.node, SessionStore.node, Agent.node, SessionContext.node]),
    [
      InstructionBuiltIns.node.replace(
        Layer.mock(InstructionBuiltIns.Service, { load: () => Effect.succeed(Instructions.empty) }),
      ),
      InstructionDiscovery.node.replace(
        Layer.mock(InstructionDiscovery.Service, {
          project: true,
          global: true,
          load: () => Effect.succeed(Instructions.empty),
        }),
      ),
      SkillInstructions.node.replace(
        Layer.mock(SkillInstructions.Service, {
          load: (permissions) => {
            received.skills = permissions
            return Effect.succeed(Instructions.empty)
          },
        }),
      ),
      ReferenceInstructions.node.replace(
        Layer.mock(ReferenceInstructions.Service, { load: () => Effect.succeed(Instructions.empty) }),
      ),
      McpInstructions.node.replace(
        Layer.mock(McpInstructions.Service, {
          load: (permissions) => {
            received.mcp = permissions
            return Effect.succeed(Instructions.empty)
          },
        }),
      ),
      McpTool.node.replace(Layer.mock(McpTool.Service, { flush: Effect.void })),
      SessionRunnerModel.node.replace(Layer.mock(SessionRunnerModel.Service, {})),
      Tool.node.replace(
        Layer.mock(Tool.Service, {
          snapshot: (permissions) => {
            received.tools = permissions
            return Effect.succeed({
              codeModeCatalog: { tools: [] },
              definitions: [],
              execute: () => Effect.die(new Error("unused")),
            })
          },
        }),
      ),
      Location.node.replace(Location.boundNode({ directory: AbsolutePath.make("/project") })),
    ],
  ),
)

describe("SessionContext", () => {
  it.effect("passes merged agent and Session permissions to tool and instruction discovery", () =>
    Effect.gen(function* () {
      const { db } = yield* Database.Service
      const agents = yield* Agent.Service
      const projects = yield* Project.Service
      const context = yield* SessionContext.Service
      const agentRule: Permission.Rule = { action: "skill", resource: "deploy", effect: "deny" }
      const sessionRules: Permission.Ruleset = [
        { action: "skill", resource: "*", effect: "deny" },
        { action: "skill", resource: "pr-review", effect: "allow" },
      ]
      yield* agents.transform((editor) =>
        editor.update(Agent.ID.make("build"), (agent) => {
          agent.permissions.push(agentRule)
        }),
      )
      const sessionID = SessionSchema.ID.make("ses_context_permissions")
      yield* db
        .insert(SessionTable)
        .values({
          id: sessionID,
          project_id: (yield* projects.resolve(AbsolutePath.make("/project"))).id,
          slug: "context-permissions",
          directory: "/project",
          title: "Context permissions",
          version: "test",
          agent: Agent.ID.make("build"),
          permission: sessionRules,
        })
        .run()
        .pipe(Effect.orDie)

      const selection = yield* context.select(sessionID)

      const expected = Permission.merge(selection.agent.info.permissions, sessionRules)
      expect(expected).toContainEqual(agentRule)
      expect(received.tools).toEqual(expected)
      expect(received.skills).toEqual(expected)
      expect(received.mcp).toEqual(expected)
      expect(Permission.evaluate("skill", "deploy", received.skills!).effect).toBe("deny")
      expect(Permission.evaluate("skill", "pr-review", received.skills!).effect).toBe("allow")
      expect(Permission.evaluate("skill", "theme-system", received.skills!).effect).toBe("deny")
    }),
  )
})
