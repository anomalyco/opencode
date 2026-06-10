import { describe, expect, test } from "bun:test"
import { SnowflakeCortexAuthPlugin } from "../../src/plugin/snowflake-cortex"

describe("SnowflakeCortexAuthPlugin", () => {
  test("returns auth hook for snowflake-cortex provider", async () => {
    const hooks = await SnowflakeCortexAuthPlugin({} as any)
    expect(hooks.auth).toBeDefined()
    expect(hooks.auth!.provider).toBe("snowflake-cortex")
  })

  test("includes exactly two methods: PAT (api) and SSO (oauth)", async () => {
    const hooks = await SnowflakeCortexAuthPlugin({} as any)
    const methods = hooks.auth!.methods
    expect(methods).toHaveLength(2)
    expect(methods[0].type).toBe("api")
    expect(methods[0].label).toBe("PAT (Programmatic Access Token)")
    expect(methods[1].type).toBe("oauth")
    expect(methods[1].label).toBe("SSO (External Browser)")
  })

  test("both methods include the account text prompt", async () => {
    const hooks = await SnowflakeCortexAuthPlugin({} as any)
    for (const method of hooks.auth!.methods) {
      expect(method.prompts).toBeDefined()
      const accountPrompt = method.prompts!.find((p) => p.key === "account")
      expect(accountPrompt).toBeDefined()
      expect(accountPrompt!.type).toBe("text")
    }
  })

  test("SSO method authorize() rejects empty account string", async () => {
    const hooks = await SnowflakeCortexAuthPlugin({} as any)
    const ssoMethod = hooks.auth!.methods.find((m) => m.type === "oauth")
    expect(ssoMethod).toBeDefined()
    if (ssoMethod?.type === "oauth") {
      await expect(ssoMethod.authorize!({ account: "" })).rejects.toThrow()
    }
  })
})
