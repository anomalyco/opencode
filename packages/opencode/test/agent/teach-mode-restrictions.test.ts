import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Global } from "@opencode-ai/core/global"
import path from "path"
import { expect, describe, test } from "bun:test"
import { Effect } from "effect"
import { Agent } from "../../src/agent/agent"
import { Permission } from "../../src/permission"
import { testEffect } from "../lib/effect"

const it = testEffect(LayerNode.compile(Agent.node))

describe("Teach Mode - Tool Restrictions", () => {
  it.instance("denies write tool globally", () =>
    Effect.gen(function* () {
      const agent = yield* Agent.use.get("teach")
      const rule = Permission.evaluate("write", "*", agent.permission)
      
      expect(rule.action).toBe("deny")
    }),
  )

  it.instance("denies edit tool globally", () =>
    Effect.gen(function* () {
      const agent = yield* Agent.use.get("teach")
      const rule = Permission.evaluate("edit", "*", agent.permission)
      
      expect(rule.action).toBe("deny")
    }),
  )

  it.instance("denies bash tool globally", () =>
    Effect.gen(function* () {
      const agent = yield* Agent.use.get("teach")
      const rule = Permission.evaluate("bash", "*", agent.permission)
      
      expect(rule.action).toBe("deny")
    }),
  )

  it.instance("denies task.general", () =>
    Effect.gen(function* () {
      const agent = yield* Agent.use.get("teach")
      const rule = Permission.evaluate("task", "general", agent.permission)
      
      expect(rule.action).toBe("deny")
    }),
  )

  it.instance("denies todowrite tool", () =>
    Effect.gen(function* () {
      const agent = yield* Agent.use.get("teach")
      const rule = Permission.evaluate("todowrite", "*", agent.permission)
      
      expect(rule.action).toBe("deny")
    }),
  )

  // Read-only tools should be allowed
  it.instance("allows read tool", () =>
    Effect.gen(function* () {
      const agent = yield* Agent.use.get("teach")
      const rule = Permission.evaluate("read", "*", agent.permission)
      
      expect(rule.action).toBe("allow")
    }),
  )

  it.instance("allows glob tool", () =>
    Effect.gen(function* () {
      const agent = yield* Agent.use.get("teach")
      const rule = Permission.evaluate("glob", "*", agent.permission)
      
      expect(rule.action).toBe("allow")
    }),
  )

  it.instance("allows grep tool", () =>
    Effect.gen(function* () {
      const agent = yield* Agent.use.get("teach")
      const rule = Permission.evaluate("grep", "*", agent.permission)
      
      expect(rule.action).toBe("allow")
    }),
  )

  it.instance("allows list tool", () =>
    Effect.gen(function* () {
      const agent = yield* Agent.use.get("teach")
      const rule = Permission.evaluate("list", "*", agent.permission)
      
      expect(rule.action).toBe("allow")
    }),
  )

  it.instance("allows question tool", () =>
    Effect.gen(function* () {
      const agent = yield* Agent.use.get("teach")
      const rule = Permission.evaluate("question", "*", agent.permission)
      
      expect(rule.action).toBe("allow")
    }),
  )

  it.instance("allows webfetch tool", () =>
    Effect.gen(function* () {
      const agent = yield* Agent.use.get("teach")
      const rule = Permission.evaluate("webfetch", "*", agent.permission)
      
      expect(rule.action).toBe("allow")
    }),
  )

  it.instance("allows websearch tool", () =>
    Effect.gen(function* () {
      const agent = yield* Agent.use.get("teach")
      const rule = Permission.evaluate("websearch", "*", agent.permission)
      
      expect(rule.action).toBe("allow")
    }),
  )

  // Teach-specific directory permissions
  it.instance("allows edit in teach data directory", () =>
    Effect.gen(function* () {
      const agent = yield* Agent.use.get("teach")
      const teachPath = path.join(Global.Path.data, "teach", "*")
      const rule = Permission.evaluate("edit", teachPath, agent.permission)
      
      expect(rule.action).toBe("allow")
    }),
  )

  it.instance("allows edit in .opencode/teach directory", () =>
    Effect.gen(function* () {
      const agent = yield* Agent.use.get("teach")
      const teachPath = path.join(".opencode", "teach", "*.md")
      const rule = Permission.evaluate("edit", teachPath, agent.permission)
      
      expect(rule.action).toBe("allow")
    }),
  )
})
