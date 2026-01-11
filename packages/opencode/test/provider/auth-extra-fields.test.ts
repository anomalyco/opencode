import { expect, mock, test } from "bun:test"

mock.module("../../src/plugin", () => ({
  Plugin: {
    list: async () => [
      {
        auth: {
          provider: "openai-test",
          methods: [
            {
              label: "Mock OAuth",
              type: "oauth",
              authorize: async () => {
                return {
                  url: "https://example.com/oauth",
                  method: "auto",
                  instructions: "Complete auth in your browser",
                  callback: async () => {
                    return {
                      type: "success",
                      refresh: "refresh-token",
                      access: "access-token",
                      expires: 123,
                      accountId: "acct_123",
                      enterpriseUrl: "https://ghe.example.com",
                    }
                  },
                }
              },
            },
          ],
        },
      },
    ],
  },
}))

const { tmpdir } = await import("../fixture/fixture")
const { Instance } = await import("../../src/project/instance")
const { ProviderAuth } = await import("../../src/provider/auth")
const { Auth } = await import("../../src/auth")

test("ProviderAuth oauth callback persists accountId and enterpriseUrl", async () => {
  await using tmp = await tmpdir()

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const auth = await ProviderAuth.authorize({
        providerID: "openai-test",
        method: 0,
      })
      expect(auth).toBeDefined()

      await ProviderAuth.callback({
        providerID: "openai-test",
        method: 0,
      })

      const saved = await Auth.get("openai-test")
      expect(saved?.type).toBe("oauth")
      expect(saved && saved.type === "oauth" ? saved.accountId : undefined).toBe("acct_123")
      expect(saved && saved.type === "oauth" ? saved.enterpriseUrl : undefined).toBe("https://ghe.example.com")
    },
  })
})
