import { describe, test, expect } from "bun:test"
import type { Permission } from "@/permission"
import type { Agent } from "@/agent/agent"
import { deriveSubagentSessionPermission } from "@/agent/subagent-permissions"

describe("Subagent Permissions", () => {
  describe("deriveSubagentSessionPermission()", () => {
    const parentSessionPermission: Permission.Ruleset = [
      { permission: "external_directory", pattern: "*", action: "deny" },
      { permission: "external_directory", pattern: "/tmp/test", action: "allow" },
    ]

    const parent: Agent.Info = {
      mode: "primary",
      name: "parent",
      options: {},
      permission: [
        { permission: "edit", pattern: "*", action: "deny" },
        { permission: "edit", pattern: ".opencode/plans/*", action: "allow" },
        { permission: "todowrite", pattern: "*", action: "allow" },
        { permission: "task", pattern: "*", action: "allow" },
      ],
    }

    const subagent: Agent.Info = {
      mode: "subagent",
      name: "child",
      options: {},
      permission: [
        { permission: "edit", pattern: "*", action: "deny" },
        { permission: "edit", pattern: ".opencode/plan/*", action: "deny" },
        { permission: "edit", pattern: ".opencode/research/*", action: "allow" },
        { permission: "todowrite", pattern: "*", action: "allow" },
        { permission: "task", pattern: "*", action: "deny" },
      ],
    }

    test("skips overriding todowrite when subagent has permission", () => {
      const derivedPermission = deriveSubagentSessionPermission({
        parentSessionPermission,
        parentAgent: parent,
        subagent,
      })

      const todowrite = derivedPermission.filter((p) => p.permission === "todowrite")

      expect(todowrite).toBeEmpty()
    })

    test("skips overriding task when subagent has permission", () => {
      const derivedPermission = deriveSubagentSessionPermission({
        parentSessionPermission,
        parentAgent: parent,
        subagent,
      })

      const task = derivedPermission.filter((p) => p.permission === "task")

      expect(task).toBeEmpty()
    })

    test("defaults todowrite permission to denied", () => {
      const permission = subagent.permission.filter((p) => p.permission !== "todowrite")
      const derivedPermission = deriveSubagentSessionPermission({
        parentSessionPermission,
        parentAgent: parent,
        subagent: { ...subagent, permission },
      })

      const todowrite = derivedPermission.filter((p) => p.permission === "todowrite")

      expect(todowrite).toEqual([{ permission: "todowrite", pattern: "*", action: "deny" }])
    })

    test("defaults task permission to denied", () => {
      const permission = subagent.permission.filter((p) => p.permission !== "task")
      const derivedPermission = deriveSubagentSessionPermission({
        parentSessionPermission,
        parentAgent: parent,
        subagent: { ...subagent, permission },
      })

      const task = derivedPermission.filter((p) => p.permission === "task")

      expect(task).toEqual([{ permission: "task", pattern: "*", action: "deny" }])
    })

    test("skips overriding edit permission if subagent already matches parent permission", () => {
      const derivedPermission = deriveSubagentSessionPermission({
        parentSessionPermission,
        parentAgent: parent,
        subagent,
      })

      const edit = derivedPermission.filter((p) => p.permission === "edit")

      expect(edit).toEqual([])
    })

    test("overries edit permission if subagent lacks parent permission", () => {
      const permission = subagent.permission.filter((p) => !(p.permission === "edit" && p.pattern === "*"))
      const derivedPermission = deriveSubagentSessionPermission({
        parentSessionPermission,
        parentAgent: parent,
        subagent: { ...subagent, permission },
      })

      const edit = derivedPermission.filter((p) => p.permission === "edit")

      expect(edit).toEqual([{ permission: "edit", pattern: "*", action: "deny" }])
    })
  })
})
