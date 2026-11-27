import { expect, test } from "bun:test"
import type { IntegrationInfo } from "@opencode/client"
import { loginChoices } from "../src/commands/handlers/auth/login"

const integration = (value: Partial<IntegrationInfo> & Pick<IntegrationInfo, "id" | "name">): IntegrationInfo => ({
  methods: [{ type: "key" }],
  connections: [],
  ...value,
})

test("groups the CLI choices like /connect while keeping stable login IDs", () => {
  expect(
    loginChoices([
      integration({ id: "mistral", name: "Mistral" }),
      integration({ id: "github-copilot", name: "GitHub Copilot" }),
      integration({ id: "claude-agent", name: "Claude Agent" }),
      integration({ id: "anthropic", name: "Anthropic" }),
      integration({ id: "openai", name: "OpenAI" }),
      integration({ id: "linear", name: "Linear", metadata: { source: "mcp" } }),
      integration({ id: "github", name: "GitHub", metadata: { source: "mcp" } }),
      integration({ id: "opencode", name: "OpenCode Console" }),
      integration({
        id: "opencode-go",
        name: "OpenCode Go",
        connections: [{ type: "credential", id: "go", label: "Go", method: "key" }],
      }),
      integration({ id: "unused", name: "Unused", methods: [{ type: "env", names: ["UNUSED_KEY"] }] }),
    ]),
  ).toEqual([
    { value: "github", label: "GitHub", category: "MCP", connected: false },
    { value: "linear", label: "Linear", category: "MCP", connected: false },
    { value: "opencode-go", label: "OpenCode Go", category: "Popular", connected: true },
    { value: "opencode", label: "OpenCode Console", category: "Popular", connected: false },
    { value: "openai", label: "OpenAI", category: "Popular", connected: false },
    { value: "anthropic", label: "Anthropic", category: "Popular", connected: false },
    { value: "claude-agent", label: "Claude Agent", category: "Popular", connected: false },
    { value: "github-copilot", label: "GitHub Copilot", category: "Popular", connected: false },
    { value: "mistral", label: "Mistral", category: "Services", connected: false },
  ])
})

test("hides OpenCode Go until a Go key is saved", () => {
  expect(
    loginChoices([
      integration({ id: "opencode", name: "OpenCode Console" }),
      integration({ id: "opencode-go", name: "OpenCode Go", connections: [{ type: "env", name: "OPENCODE_API_KEY" }] }),
    ]).map((choice) => choice.value),
  ).toEqual(["opencode"])
})
