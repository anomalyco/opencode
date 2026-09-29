import { describe, expect, test } from "bun:test"
import type { IntegrationInfo } from "@opencode/client"
import {
  connectionSummary,
  connectMethods,
  credentialConnections,
  integrationOptions,
} from "../../../../src/component/dialog-integration"

const integration = (value: Partial<IntegrationInfo> & Pick<IntegrationInfo, "id" | "name">): IntegrationInfo => ({
  methods: [],
  connections: [],
  ...value,
})

describe("integrationOptions", () => {
  test("keeps popular integrations first and sorts the rest alphabetically", () => {
    expect(
      integrationOptions([
        integration({ id: "mistral", name: "Mistral" }),
        integration({ id: "openai", name: "OpenAI" }),
        integration({ id: "custom-z", name: "Zebra" }),
        integration({ id: "anthropic", name: "Anthropic" }),
        integration({ id: "opencode", name: "OpenCode Zen" }),
        integration({ id: "opencode-go", name: "OpenCode Go" }),
      ]).map((item) => item.id),
    ).toEqual(["opencode-go", "opencode", "openai", "anthropic", "mistral", "custom-z"])
  })

  test("keeps MCP integrations above popular integrations without relying on their IDs", () => {
    expect(
      integrationOptions([
        integration({ id: "openai", name: "OpenAI" }),
        integration({ id: "linear", name: "Linear", metadata: { source: "mcp" } }),
        integration({ id: "github", name: "GitHub", metadata: { source: "mcp" } }),
        integration({ id: "opencode", name: "OpenCode Zen" }),
        integration({ id: "opencode-go", name: "OpenCode Go" }),
      ]).map((item) => item.id),
    ).toEqual(["github", "linear", "opencode-go", "opencode", "openai"])
  })
})

describe("connectMethods", () => {
  test("orders OpenAI sign-in, API key, and both Codex methods", () => {
    expect(
      connectMethods(
        integration({
          id: "openai",
          name: "OpenAI",
          methods: [
            { type: "oauth", id: "chatgpt-headless", label: "Codex headless" },
            { type: "key", label: "API key" },
            { type: "oauth", id: "chatgpt-browser", label: "Codex browser" },
            { type: "oauth", id: "chatgpt-token-sharing", label: "Sign in with ChatGPT" },
          ],
        }),
      ).map((method) => (method.type === "key" ? "key" : method.id)),
    ).toEqual(["chatgpt-token-sharing", "key", "chatgpt-browser", "chatgpt-headless"])
  })

  test("offers key and OAuth methods but not environment discovery", () => {
    expect(
      connectMethods(
        integration({
          id: "example",
          name: "Example",
          methods: [
            { type: "env", names: ["EXAMPLE_KEY"] },
            { type: "key", label: "API key" },
            { type: "oauth", id: "account", label: "Account" },
          ],
        }),
      ).map((method) => method.type),
    ).toEqual(["oauth", "key"])
  })
})

describe("credentialConnections", () => {
  test("returns removable credential connections only", () => {
    expect(
      credentialConnections(
        integration({
          id: "example",
          name: "Example",
          connections: [
            { type: "env", name: "EXAMPLE_KEY" },
            { type: "credential", method: "key", id: "cred_1", label: "Work" },
          ],
        }),
      ),
    ).toEqual([{ type: "credential", method: "key", id: "cred_1", label: "Work" }])
  })
})

describe("connectionSummary", () => {
  test("shows credential labels and environment variables", () => {
    expect(
      connectionSummary(
        integration({
          id: "example",
          name: "Example",
          connections: [
            { type: "credential", method: "key", id: "cred_1", label: "Work" },
            { type: "env", name: "EXAMPLE_KEY" },
          ],
        }),
      ),
    ).toBe("Work, $EXAMPLE_KEY")
  })
})
