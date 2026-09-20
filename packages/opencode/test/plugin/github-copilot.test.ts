import { afterEach, expect, mock, test } from "bun:test"
import type { Hooks } from "@opencode-ai/plugin"
import { CopilotAuthPlugin } from "@/plugin/github-copilot/copilot"

type ChatHeaders = NonNullable<Hooks["chat.headers"]>

const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
})

async function plugin() {
  return CopilotAuthPlugin({
    directory: "",
    project: {} as never,
    worktree: "",
    experimental_workspace: { register() {} },
    serverUrl: new URL("http://localhost"),
    $: {} as never,
    client: {
      session: {
        message: async () => ({ data: { parts: [] } }),
        get: async () => ({ data: {} }),
      },
    } as never,
  })
}

async function hook() {
  return (await plugin())["chat.headers"]!
}

function input(sessionID: string, providerID: string, npm: string) {
  return {
    sessionID,
    agent: "build",
    model: { providerID, api: { npm } },
    message: { id: "msg_test", sessionID },
  } as Parameters<ChatHeaders>[0]
}

test.each([
  ["github-copilot", "@ai-sdk/github-copilot"],
  ["github-copilot", "@ai-sdk/anthropic"],
  ["github-copilot-enterprise", "@ai-sdk/github-copilot"],
  ["github-copilot-enterprise", "@ai-sdk/anthropic"],
])("uses the session ID for %s interaction headers with %s", async (providerID, npm) => {
  const headers = await hook()
  for (const sessionID of ["ses_one", "ses_one", "ses_two"]) {
    const output = { headers: { "x-existing": "preserved" } }
    await headers(input(sessionID, providerID, npm), output)
    expect(output.headers).toMatchObject({
      "X-Interaction-Id": sessionID,
      "x-existing": "preserved",
    })
  }
})

test("does not add interaction headers to other providers", async () => {
  const headers = await hook()
  const output = { headers: { "x-existing": "preserved" } }
  await headers(input("ses_one", "openai", "@ai-sdk/openai"), output)
  expect(output.headers).toEqual({ "x-existing": "preserved" })
})

test("pins the Copilot integration header on oauth inference requests", async () => {
  const hooks = await plugin()
  const { fetch: copilotFetch } = await hooks.auth!.loader!(
    async () =>
      ({
        type: "oauth",
        refresh: "refresh-token",
        access: "access-token",
        expires: Date.now() + 60_000,
      } as never),
    {} as never,
  )

  let seen: Record<string, string> | undefined
  globalThis.fetch = mock(async (_input: unknown, init?: RequestInit) => {
    seen = init?.headers as Record<string, string>
    return new Response("")
  }) as unknown as typeof fetch

  await copilotFetch("https://api.githubcopilot.com/chat/completions", {
    method: "POST",
    headers: { "x-api-key": "stale" },
    body: JSON.stringify({ messages: [{ role: "user", content: "hi" }] }),
  })

  expect(seen).toMatchObject({
    "Copilot-Integration-Id": "vscode-chat",
    Authorization: "Bearer refresh-token",
    "Openai-Intent": "conversation-edits",
  })
  expect(seen?.["x-api-key"]).toBeUndefined()
})

test("does not provide a fetch override for non-oauth auth", async () => {
  const hooks = await plugin()
  const result = await hooks.auth!.loader!(
    async () => ({ type: "api", key: "sk-test" } as never),
    {} as never,
  )

  expect(result).toEqual({})
})
