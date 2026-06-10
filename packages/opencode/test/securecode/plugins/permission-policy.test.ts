import { describe, expect, test } from "bun:test"
import {
  EXEMPT_PERMISSIONS,
  PermissionPolicyPlugin,
  shouldEnforce,
} from "../../../src/securecode/plugins/permission-policy"
import type { ConfigPermission } from "../../../src/config/permission"

type Hook = NonNullable<Awaited<ReturnType<typeof PermissionPolicyPlugin>>["permission.ask"]>

const stubInput = (permission: ConfigPermission.Info = {}) =>
  ({
    client: {
      config: {
        get: async () => ({ data: { permission } }),
      },
    },
  }) as unknown as Parameters<typeof PermissionPolicyPlugin>[0]

const baseInput = (type: string, pattern: string = "*") =>
  ({
    id: "per_test",
    type,
    pattern,
    sessionID: "s1",
    messageID: "m1",
    callID: "c1",
    title: "",
    metadata: {},
    time: { created: 0 },
  }) as unknown as Parameters<Hook>[0]

const runHook = async (
  permission: ConfigPermission.Info,
  type: string,
  pattern: string,
  status: "allow" | "deny" | "ask",
) => {
  const hooks = await PermissionPolicyPlugin(stubInput(permission))
  const hook = hooks["permission.ask"]!
  const output = { status: status as "ask" | "deny" | "allow" }
  await hook(baseInput(type, pattern), output)
  return output.status
}

// Tools whose ctx.ask calls actually flow through the `permission.ask` hook
// AND are NOT in EXEMPT_PERMISSIONS, so the policy plugin should escalate
// allow → ask when the user has not explicitly opted in.
// See packages/opencode/src/tool/* (bash.ts, edit.ts, etc.).
// Local read-only tools (read, grep, glob) are exempt — see EXEMPT_PERMISSIONS.
const HOOKED_PERMISSIONS = [
  "bash",
  "edit",
  "task",
  "webfetch",
  "websearch",
] as const

describe("shouldEnforce", () => {
  test("with empty user config, raises allow -> ask for every non-exempt permission", () => {
    for (const tool of HOOKED_PERMISSIONS) {
      expect(shouldEnforce(tool, "*", "allow", {})).toBe(true)
    }
  })

  test("does not enforce when config status is already ask", () => {
    expect(shouldEnforce("bash", "*", "ask", {})).toBe(false)
  })

  test("does not enforce when config status is deny", () => {
    expect(shouldEnforce("bash", "*", "deny", {})).toBe(false)
  })

  test("never enforces exempt permissions even when config is empty", () => {
    for (const tool of EXEMPT_PERMISSIONS) {
      expect(shouldEnforce(tool, "*", "allow", {})).toBe(false)
    }
  })

  test("string-form user allow bypasses escalation for that tool", () => {
    expect(shouldEnforce("bash", "mkdir", "allow", { bash: "allow" })).toBe(false)
    expect(shouldEnforce("bash", "anything", "allow", { bash: "allow" })).toBe(false)
  })

  test("object-form user allow bypasses escalation only for matching patterns", () => {
    expect(shouldEnforce("bash", "mkdir", "allow", { bash: { mkdir: "allow" } })).toBe(false)
    expect(shouldEnforce("bash", "rm", "allow", { bash: { mkdir: "allow" } })).toBe(true)
  })

  test("user wildcard pattern bypasses matching prefixes only", () => {
    const cfg: ConfigPermission.Info = { bash: { "git *": "allow" } }
    expect(shouldEnforce("bash", "git add", "allow", cfg)).toBe(false)
    expect(shouldEnforce("bash", "git", "allow", cfg)).toBe(false)
    expect(shouldEnforce("bash", "rm", "allow", cfg)).toBe(true)
  })

  test("user allow for one tool does not bypass other tools", () => {
    const cfg: ConfigPermission.Info = { bash: "allow" }
    expect(shouldEnforce("bash", "*", "allow", cfg)).toBe(false)
    expect(shouldEnforce("webfetch", "*", "allow", cfg)).toBe(true)
    expect(shouldEnforce("edit", "*", "allow", cfg)).toBe(true)
  })

  test("user-explicit ask is still treated as 'no opt-in' (escalation continues)", () => {
    // User wrote `bash: ask`. If a downstream layer (e.g. session override)
    // still pushes the resolved status to `allow`, the policy plugin
    // re-raises it because the user did not write `allow`.
    expect(shouldEnforce("bash", "*", "allow", { bash: "ask" })).toBe(true)
  })

  test("local read-only tools (read/grep/glob) are exempt — Layer 2 sandbox bounds them", () => {
    // No user opt-in, agent-default allow stays allow because these tools'
    // blast radius is already capped by the OS-level filesystem sandbox.
    expect(shouldEnforce("read", "/some/file.txt", "allow", {})).toBe(false)
    expect(shouldEnforce("grep", "TODO", "allow", {})).toBe(false)
    expect(shouldEnforce("glob", "**/*.ts", "allow", {})).toBe(false)
  })
})

describe("PermissionPolicyPlugin permission.ask hook", () => {
  test("rewrites allow -> ask for every non-exempt permission when user config is empty", async () => {
    for (const tool of HOOKED_PERMISSIONS) {
      expect(await runHook({}, tool, "*", "allow")).toBe("ask")
    }
  })

  test("leaves allow alone when the user explicitly allowed the tool (string form)", async () => {
    expect(await runHook({ bash: "allow" }, "bash", "mkdir", "allow")).toBe("allow")
  })

  test("leaves allow alone when the user explicitly allowed the specific pattern", async () => {
    expect(await runHook({ bash: { mkdir: "allow" } }, "bash", "mkdir", "allow")).toBe("allow")
  })

  test("rewrites to ask when the user allowed a different pattern", async () => {
    expect(await runHook({ bash: { mkdir: "allow" } }, "bash", "rm", "allow")).toBe("ask")
  })

  test("honors user wildcard pattern for matching commands", async () => {
    expect(await runHook({ bash: { "git *": "allow" } }, "bash", "git add", "allow")).toBe("allow")
    expect(await runHook({ bash: { "git *": "allow" } }, "bash", "rm", "allow")).toBe("ask")
  })

  test("leaves allow alone for read/grep/glob even when user has not opted in", async () => {
    expect(await runHook({}, "read", "/some/file.txt", "allow")).toBe("allow")
    expect(await runHook({}, "grep", "TODO", "allow")).toBe("allow")
    expect(await runHook({}, "glob", "**/*.ts", "allow")).toBe("allow")
  })

  test("leaves allow alone for every exempt permission", async () => {
    for (const tool of EXEMPT_PERMISSIONS) {
      expect(await runHook({}, tool, "*", "allow")).toBe("allow")
    }
  })

  test("leaves deny untouched for any permission", async () => {
    expect(await runHook({}, "bash", "*", "deny")).toBe("deny")
    expect(await runHook({}, "edit", "*", "deny")).toBe("deny")
  })

  test("leaves ask untouched for any permission", async () => {
    expect(await runHook({}, "bash", "*", "ask")).toBe("ask")
    expect(await runHook({}, "edit", "*", "ask")).toBe("ask")
  })

  test("falls back to escalation when SDK call fails", async () => {
    const failingInput = {
      client: {
        config: {
          get: async () => {
            throw new Error("network down")
          },
        },
      },
    } as unknown as Parameters<typeof PermissionPolicyPlugin>[0]
    const hooks = await PermissionPolicyPlugin(failingInput)
    const hook = hooks["permission.ask"]!
    const output = { status: "allow" as "ask" | "deny" | "allow" }
    await hook(baseInput("bash", "*"), output)
    expect(output.status).toBe("ask")
  })
})
