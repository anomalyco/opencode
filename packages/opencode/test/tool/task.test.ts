import { describe, expect, test } from "bun:test"
import path from "path"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"
import { PermissionNext } from "../../src/permission/next"
import { Agent } from "../../src/agent/agent"

const root = path.join(__dirname, "../..")

function planPerms(): PermissionNext.Ruleset {
  return PermissionNext.fromConfig({
    "*": "allow",
    edit: { "*": "deny" },
  })
}

function buildPerms(): PermissionNext.Ruleset {
  return PermissionNext.fromConfig({
    "*": "allow",
    edit: { "*": "allow" },
  })
}

describe("tool.task Plan Mode Security", () => {
  describe("Plan mode detection", () => {
    test("detects Plan mode when edit='deny' globally", async () => {
      await Instance.provide({
        directory: root,
        fn: async () => {
          const perms = planPerms()
          const rule = perms.findLast((r) => r.permission === "edit" && r.pattern === "*")
          expect(rule).toBeDefined()
          expect(rule?.action).toBe("deny")
        },
      })
    })

    test("does not detect Plan mode when edit='allow'", async () => {
      await Instance.provide({
        directory: root,
        fn: async () => {
          const perms = buildPerms()
          const rule = perms.findLast((r) => r.permission === "edit" && r.pattern === "*")
          expect(rule?.action).not.toBe("deny")
        },
      })
    })

    test("plan agent has edit deny restriction", async () => {
      await Instance.provide({
        directory: root,
        fn: async () => {
          const agent = await Agent.get("plan")
          expect(agent).toBeDefined()
          if (agent) {
            const rule = agent.permission.findLast((r) => r.permission === "edit" && r.pattern === "*")
            expect(rule?.action).toBe("deny")
          }
        },
      })
    })

    test("build agent does not have edit deny restriction", async () => {
      await Instance.provide({
        directory: root,
        fn: async () => {
          const agent = await Agent.get("build")
          expect(agent).toBeDefined()
          if (agent) {
            const rule = agent.permission.findLast((r) => r.permission === "edit" && r.pattern === "*")
            expect(rule?.action).not.toBe("deny")
          }
        },
      })
    })
  })

  describe("Permission rules", () => {
    test("edit tools are denied in Plan mode permissions", async () => {
      await Instance.provide({
        directory: root,
        fn: async () => {
          const tools = ["edit", "write", "patch", "multiedit"]
          const perms = PermissionNext.fromConfig({
            edit: { "*": "deny" },
            write: { "*": "deny" },
            patch: { "*": "deny" },
            multiedit: { "*": "deny" },
          })
          for (const tool of tools) {
            const rule = perms.find((r) => r.permission === tool && r.pattern === "*" && r.action === "deny")
            expect(rule).toBeDefined()
          }
        },
      })
    })
  })

  describe("Agent availability", () => {
    test("plan agent is available", async () => {
      await Instance.provide({
        directory: root,
        fn: async () => {
          const agent = await Agent.get("plan")
          expect(agent).toBeDefined()
          expect(agent?.name).toBe("plan")
        },
      })
    })

    test("plan agent has correct mode", async () => {
      await Instance.provide({
        directory: root,
        fn: async () => {
          const agent = await Agent.get("plan")
          expect(agent?.mode).toBe("primary")
        },
      })
    })

    test("general agent is subagent", async () => {
      await Instance.provide({
        directory: root,
        fn: async () => {
          const agent = await Agent.get("general")
          expect(agent?.name).toBe("general")
          expect(agent?.mode).toBe("subagent")
        },
      })
    })

    test("explore agent is subagent", async () => {
      await Instance.provide({
        directory: root,
        fn: async () => {
          const agent = await Agent.get("explore")
          expect(agent?.name).toBe("explore")
          expect(agent?.mode).toBe("subagent")
        },
      })
    })
  })

  describe("Permission evaluation", () => {
    test("evaluate returns deny for edit in Plan mode", async () => {
      await Instance.provide({
        directory: root,
        fn: async () => {
          const perms = planPerms()
          const result = PermissionNext.evaluate("edit", "test.ts", perms)
          expect(result.action).toBe("deny")
        },
      })
    })

    test("evaluate returns allow for edit in Build mode", async () => {
      await Instance.provide({
        directory: root,
        fn: async () => {
          const perms = buildPerms()
          const result = PermissionNext.evaluate("edit", "test.ts", perms)
          expect(result.action).toBe("allow")
        },
      })
    })

    test("disabled identifies edit tools as disabled", async () => {
      await Instance.provide({
        directory: root,
        fn: async () => {
          const perms = PermissionNext.fromConfig({
            edit: { "*": "deny" },
            write: { "*": "deny" },
            patch: { "*": "deny" },
            multiedit: { "*": "deny" },
          })
          const disabled = PermissionNext.disabled(["edit", "write", "patch", "multiedit", "read", "bash"], perms)
          expect(disabled.has("edit")).toBe(true)
          expect(disabled.has("write")).toBe(true)
          expect(disabled.has("patch")).toBe(true)
          expect(disabled.has("multiedit")).toBe(true)
          expect(disabled.has("read")).toBe(false)
          expect(disabled.has("bash")).toBe(false)
        },
      })
    })
  })

  describe("Security", () => {
    test("plan agent denies file edits", async () => {
      await Instance.provide({
        directory: root,
        fn: async () => {
          const agent = await Agent.get("plan")
          expect(agent).toBeDefined()
          if (agent) {
            const result = PermissionNext.evaluate("edit", "any.ts", agent.permission)
            expect(result.action).toBe("deny")
          }
        },
      })
    })

    test("plan agent allows reading files", async () => {
      await Instance.provide({
        directory: root,
        fn: async () => {
          const agent = await Agent.get("plan")
          expect(agent).toBeDefined()
          if (agent) {
            const result = PermissionNext.evaluate("read", "any.ts", agent.permission)
            expect(result.action).toBe("allow")
          }
        },
      })
    })

    test("build agent allows file edits", async () => {
      await Instance.provide({
        directory: root,
        fn: async () => {
          const agent = await Agent.get("build")
          expect(agent).toBeDefined()
          if (agent) {
            const result = PermissionNext.evaluate("edit", "any.ts", agent.permission)
            expect(result.action).not.toBe("deny")
          }
        },
      })
    })

    test("explore agent allows grep", async () => {
      await Instance.provide({
        directory: root,
        fn: async () => {
          const agent = await Agent.get("explore")
          expect(agent).toBeDefined()
          if (agent) {
            const result = PermissionNext.evaluate("grep", "*", agent.permission)
            expect(result.action).toBe("allow")
          }
        },
      })
    })
  })
})

describe("tool.task permission filtering", () => {
  test("subagents exist", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const agents = await Agent.list()
        const subs = agents.filter((a) => a.mode !== "primary")
        expect(subs.length).toBeGreaterThan(0)
        expect(subs.find((a) => a.name === "general")).toBeDefined()
        expect(subs.find((a) => a.name === "explore")).toBeDefined()
      },
    })
  })

  test("agent list includes core agents", async () => {
    await Instance.provide({
      directory: root,
      fn: async () => {
        const agents = await Agent.list()
        const names = agents.map((a) => a.name)
        expect(names).toContain("build")
        expect(names).toContain("plan")
        expect(names).toContain("general")
        expect(names).toContain("explore")
      },
    })
  })
})
