import { test, expect, describe } from "bun:test"
import { Permission } from "../../src/permission/index"

describe("isDangerousBashPermission", () => {
  describe("broad wildcard patterns", () => {
    test("warns on Bash(*) allow rule", () => {
      const result = Permission.isDangerousBashPermission({
        permission: "bash",
        pattern: "*",
        action: "allow",
      })
      expect(result).not.toBeNull()
      expect(result?.severity).toBe("warn")
      expect(result?.warning).toContain("ALL bash commands")
    })

    test("warns on empty pattern allow rule", () => {
      const result = Permission.isDangerousBashPermission({
        permission: "bash",
        pattern: "",
        action: "allow",
      })
      expect(result).not.toBeNull()
      expect(result?.severity).toBe("warn")
    })

    test("does not warn on deny rules", () => {
      const result = Permission.isDangerousBashPermission({
        permission: "bash",
        pattern: "*",
        action: "deny",
      })
      expect(result).toBeNull()
    })
  })

  describe("interpreter prefix patterns", () => {
    test("warns on 'python *' allow rule", () => {
      const result = Permission.isDangerousBashPermission({
        permission: "bash",
        pattern: "python *",
        action: "allow",
      })
      expect(result).not.toBeNull()
      expect(result?.warning).toContain("python")
      expect(result?.warning).toContain("interpreter")
    })

    test("warns on 'node *' allow rule", () => {
      const result = Permission.isDangerousBashPermission({
        permission: "bash",
        pattern: "node *",
        action: "allow",
      })
      expect(result).not.toBeNull()
      expect(result?.warning).toContain("node")
      expect(result?.warning).toContain("interpreter")
    })

    test("warns on 'deno run *' allow rule", () => {
      const result = Permission.isDangerousBashPermission({
        permission: "bash",
        pattern: "deno run *",
        action: "allow",
      })
      expect(result).not.toBeNull()
      expect(result?.warning).toContain("deno run")
    })

    test("warns on 'bun test *' allow rule", () => {
      const result = Permission.isDangerousBashPermission({
        permission: "bash",
        pattern: "bun test *",
        action: "allow",
      })
      expect(result).not.toBeNull()
      expect(result?.warning).toContain("bun test")
    })
  })

  describe("package runner prefix patterns", () => {
    test("warns on 'npx *' allow rule", () => {
      const result = Permission.isDangerousBashPermission({
        permission: "bash",
        pattern: "npx *",
        action: "allow",
      })
      expect(result).not.toBeNull()
      expect(result?.warning).toContain("npx")
      expect(result?.warning).toContain("package-runner")
    })

    test("warns on 'npm run *' allow rule", () => {
      const result = Permission.isDangerousBashPermission({
        permission: "bash",
        pattern: "npm run *",
        action: "allow",
      })
      expect(result).not.toBeNull()
      expect(result?.warning).toContain("npm run")
    })
  })

  describe("shell/eval prefix patterns", () => {
    test("warns on 'bash -c *' allow rule", () => {
      const result = Permission.isDangerousBashPermission({
        permission: "bash",
        pattern: "bash -c *",
        action: "allow",
      })
      expect(result).not.toBeNull()
      expect(result?.warning).toContain("bash -c")
      expect(result?.warning).toContain("shell-eval")
    })

    test("warns on 'eval *' allow rule", () => {
      const result = Permission.isDangerousBashPermission({
        permission: "bash",
        pattern: "eval *",
        action: "allow",
      })
      expect(result).not.toBeNull()
      expect(result?.warning).toContain("eval")
    })
  })

  describe("privilege escalation patterns", () => {
    test("warns on 'sudo *' allow rule", () => {
      const result = Permission.isDangerousBashPermission({
        permission: "bash",
        pattern: "sudo *",
        action: "allow",
      })
      expect(result).not.toBeNull()
      expect(result?.warning).toContain("sudo")
      expect(result?.warning).toContain("privilege")
    })

    test("warns on 'su *' allow rule", () => {
      const result = Permission.isDangerousBashPermission({
        permission: "bash",
        pattern: "su *",
        action: "allow",
      })
      expect(result).not.toBeNull()
      expect(result?.warning).toContain("su")
    })
  })

  describe("filesystem patterns", () => {
    test("warns on 'rm *' allow rule", () => {
      const result = Permission.isDangerousBashPermission({
        permission: "bash",
        pattern: "rm *",
        action: "allow",
      })
      expect(result).not.toBeNull()
      expect(result?.warning).toContain("rm")
      expect(result?.warning).toContain("filesystem")
    })
  })

  describe("safe patterns", () => {
    test("allows specific git commands", () => {
      const result = Permission.isDangerousBashPermission({
        permission: "bash",
        pattern: "git status",
        action: "allow",
      })
      expect(result).toBeNull()
    })

    test("allows specific ls commands", () => {
      const result = Permission.isDangerousBashPermission({
        permission: "bash",
        pattern: "ls *",
        action: "allow",
      })
      expect(result).toBeNull()
    })

    test("allows specific npm commands", () => {
      const result = Permission.isDangerousBashPermission({
        permission: "bash",
        pattern: "npm install",
        action: "allow",
      })
      expect(result).toBeNull()
    })

    test("does not warn for non-bash permissions", () => {
      const result = Permission.isDangerousBashPermission({
        permission: "edit",
        pattern: "*",
        action: "allow",
      })
      expect(result).toBeNull()
    })
  })
})

describe("checkDangerousRules", () => {
  test("returns empty array for safe ruleset", () => {
    const result = Permission.checkDangerousRules([
      { permission: "bash", pattern: "git status", action: "allow" },
      { permission: "bash", pattern: "ls", action: "allow" },
    ])
    expect(result).toHaveLength(0)
  })

  test("returns warnings for dangerous rules", () => {
    const result = Permission.checkDangerousRules([
      { permission: "bash", pattern: "git status", action: "allow" },
      { permission: "bash", pattern: "python *", action: "allow" },
      { permission: "bash", pattern: "sudo *", action: "allow" },
    ])
    expect(result).toHaveLength(2)
  })

  test("does not warn for deny rules", () => {
    const result = Permission.checkDangerousRules([
      { permission: "bash", pattern: "*", action: "deny" },
      { permission: "bash", pattern: "python:*", action: "deny" },
    ])
    expect(result).toHaveLength(0)
  })

  test("warns on completely broad pattern", () => {
    const result = Permission.checkDangerousRules([{ permission: "bash", pattern: "*", action: "allow" }])
    expect(result).toHaveLength(1)
    expect(result[0].warning).toContain("ALL bash commands")
  })
})
