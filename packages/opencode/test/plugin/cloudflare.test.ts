import { expect, test } from "bun:test"
import { CloudflareAIGatewayAuthPlugin } from "@/plugin/cloudflare"

const pluginInput = {
  client: {} as never,
  project: {} as never,
  directory: "",
  worktree: "",
  experimental_workspace: {
    register() {},
  },
  serverUrl: new URL("https://example.com"),
  $: {} as never,
}

test("registers the cloudflare-ai-gateway auth method", async () => {
  const hooks = await CloudflareAIGatewayAuthPlugin(pluginInput)
  expect(hooks.auth?.provider).toBe("cloudflare-ai-gateway")
  expect(hooks.auth?.methods).toHaveLength(1)
})

test("no longer drops maxOutputTokens; OpenAI models ride the Responses API passthrough", async () => {
  const hooks = await CloudflareAIGatewayAuthPlugin(pluginInput)
  expect(hooks["chat.params"]).toBeUndefined()
})
