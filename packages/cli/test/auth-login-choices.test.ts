import { expect, test } from "bun:test"
import type { IntegrationInfo } from "@opencode/client"
import { loginChoices } from "../src/commands/handlers/auth/login"
import { connectMethods } from "../src/commands/handlers/auth/shared"

const integration = (value: Partial<IntegrationInfo> & Pick<IntegrationInfo, "id" | "name">): IntegrationInfo => ({
  methods: [{ type: "key" }],
  connections: [],
  ...value,
})

test("orders OpenAI authentication methods without changing other providers", () => {
  const methods: IntegrationInfo["methods"] = [
    { type: "oauth", id: "chatgpt-headless", label: "Codex headless" },
    { type: "key", label: "API key" },
    { type: "oauth", id: "chatgpt-browser", label: "Codex browser" },
    { type: "oauth", id: "chatgpt-token-sharing", label: "Sign in with ChatGPT" },
  ]
  expect(
    connectMethods(integration({ id: "openai", name: "OpenAI", methods })).map((method) =>
      method.type === "key" ? "key" : method.id,
    ),
  ).toEqual(["chatgpt-token-sharing", "key", "chatgpt-browser", "chatgpt-headless"])
  expect(connectMethods(integration({ id: "example", name: "Example", methods })).map((method) => method.type)).toEqual(
    ["oauth", "oauth", "oauth", "key"],
  )
})

test("groups the CLI choices like /connect while keeping stable login IDs", () => {
  expect(
    loginChoices([
      integration({ id: "mistral", name: "Mistral" }),
      integration({ id: "openai", name: "OpenAI" }),
      integration({ id: "linear", name: "Linear", metadata: { source: "mcp" } }),
      integration({ id: "github", name: "GitHub", metadata: { source: "mcp" } }),
      integration({ id: "opencode", name: "OpenCode Console" }),
      integration({ id: "opencode-go", name: "OpenCode Go", connections: [{ type: "env", name: "GO_KEY" }] }),
      integration({ id: "unused", name: "Unused", methods: [{ type: "env", names: ["UNUSED_KEY"] }] }),
    ]),
  ).toEqual([
    { value: "github", label: "GitHub", category: "MCP", connected: false },
    { value: "linear", label: "Linear", category: "MCP", connected: false },
    { value: "opencode-go", label: "OpenCode Go", category: "Popular", connected: true },
    { value: "opencode", label: "OpenCode Console", category: "Popular", connected: false },
    { value: "openai", label: "OpenAI", category: "Popular", connected: false },
    { value: "mistral", label: "Mistral", category: "Services", connected: false },
  ])
})
