import { describe, expect, test } from "bun:test"
import {
  ENFORCED_TOOLS,
  PermissionPolicyPlugin,
  shouldEnforce,
} from "../../../src/securecode/plugins/permission-policy"

const stubPluginInput = {} as Parameters<typeof PermissionPolicyPlugin>[0]

const baseInput = (type: string) =>
  ({
    id: "per_test",
    type,
    pattern: "*",
    sessionID: "s1",
    messageID: "m1",
    callID: "c1",
    title: "",
    metadata: {},
    time: { created: 0 },
  }) as unknown as Parameters<
    NonNullable<Awaited<ReturnType<typeof PermissionPolicyPlugin>>["permission.ask"]>
  >[0]

describe("shouldEnforce", () => {
  test("raises allow -> ask for each enforced tool", () => {
    for (const tool of ["bash", "edit", "write", "task", "webfetch", "websearch"]) {
      expect(shouldEnforce(tool, "allow")).toBe(true)
    }
  })

  test("does not enforce when config status is already ask", () => {
    expect(shouldEnforce("bash", "ask")).toBe(false)
  })

  test("does not enforce when config status is deny", () => {
    expect(shouldEnforce("bash", "deny")).toBe(false)
  })

  test("does not enforce read-only / non-listed tools even when allowed", () => {
    for (const tool of ["read", "grep", "glob", "list", "todowrite", "question"]) {
      expect(shouldEnforce(tool, "allow")).toBe(false)
    }
  })
})

describe("PermissionPolicyPlugin permission.ask hook", () => {
  test("rewrites allow -> ask for enforced tools", async () => {
    const hooks = await PermissionPolicyPlugin(stubPluginInput)
    const hook = hooks["permission.ask"]!
    for (const tool of ENFORCED_TOOLS) {
      const output = { status: "allow" as "ask" | "deny" | "allow" }
      await hook(baseInput(tool), output)
      expect(output.status).toBe("ask")
    }
  })

  test("leaves deny untouched for enforced tools", async () => {
    const hooks = await PermissionPolicyPlugin(stubPluginInput)
    const hook = hooks["permission.ask"]!
    const output = { status: "deny" as "ask" | "deny" | "allow" }
    await hook(baseInput("bash"), output)
    expect(output.status).toBe("deny")
  })

  test("leaves ask untouched for enforced tools", async () => {
    const hooks = await PermissionPolicyPlugin(stubPluginInput)
    const hook = hooks["permission.ask"]!
    const output = { status: "ask" as "ask" | "deny" | "allow" }
    await hook(baseInput("bash"), output)
    expect(output.status).toBe("ask")
  })

  test("does not touch non-enforced tools", async () => {
    const hooks = await PermissionPolicyPlugin(stubPluginInput)
    const hook = hooks["permission.ask"]!
    const output = { status: "allow" as "ask" | "deny" | "allow" }
    await hook(baseInput("read"), output)
    expect(output.status).toBe("allow")
  })
})
