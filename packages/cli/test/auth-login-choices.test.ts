import { Integration } from "@opencode/schema/integration"
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
      integration({ id: Integration.ID.make("mistral", { disableChecks: true }), name: "Mistral" }),
      integration({ id: Integration.ID.make("openai", { disableChecks: true }), name: "OpenAI" }),
      integration({
        id: Integration.ID.make("linear", { disableChecks: true }),
        name: "Linear",
        metadata: { source: "mcp" },
      }),
      integration({
        id: Integration.ID.make("github", { disableChecks: true }),
        name: "GitHub",
        metadata: { source: "mcp" },
      }),
      integration({ id: Integration.ID.make("opencode", { disableChecks: true }), name: "OpenCode Console" }),
      integration({
        id: Integration.ID.make("opencode-go", { disableChecks: true }),
        name: "OpenCode Go",
        connections: [{ type: "env", name: "GO_KEY" }],
      }),
      integration({
        id: Integration.ID.make("unused", { disableChecks: true }),
        name: "Unused",
        methods: [{ type: "env", names: ["UNUSED_KEY"] }],
      }),
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
