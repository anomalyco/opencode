import { Credential } from "@opencode/schema/credential"
import { Integration } from "@opencode/schema/integration"
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
        integration({ id: Integration.ID.make("mistral", { disableChecks: true }), name: "Mistral" }),
        integration({ id: Integration.ID.make("openai", { disableChecks: true }), name: "OpenAI" }),
        integration({ id: Integration.ID.make("custom-z", { disableChecks: true }), name: "Zebra" }),
        integration({ id: Integration.ID.make("anthropic", { disableChecks: true }), name: "Anthropic" }),
        integration({ id: Integration.ID.make("opencode", { disableChecks: true }), name: "OpenCode Zen" }),
        integration({ id: Integration.ID.make("opencode-go", { disableChecks: true }), name: "OpenCode Go" }),
      ]).map((item) => item.id),
    ).toEqual([
      Integration.ID.make("opencode-go", { disableChecks: true }),
      Integration.ID.make("opencode", { disableChecks: true }),
      Integration.ID.make("openai", { disableChecks: true }),
      Integration.ID.make("anthropic", { disableChecks: true }),
      Integration.ID.make("mistral", { disableChecks: true }),
      Integration.ID.make("custom-z", { disableChecks: true }),
    ])
  })

  test("keeps MCP integrations above popular integrations without relying on their IDs", () => {
    expect(
      integrationOptions([
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
        integration({ id: Integration.ID.make("opencode", { disableChecks: true }), name: "OpenCode Zen" }),
        integration({ id: Integration.ID.make("opencode-go", { disableChecks: true }), name: "OpenCode Go" }),
      ]).map((item) => item.id),
    ).toEqual([
      Integration.ID.make("github", { disableChecks: true }),
      Integration.ID.make("linear", { disableChecks: true }),
      Integration.ID.make("opencode-go", { disableChecks: true }),
      Integration.ID.make("opencode", { disableChecks: true }),
      Integration.ID.make("openai", { disableChecks: true }),
    ])
  })
})

describe("connectMethods", () => {
  test("offers key and OAuth methods but not environment discovery", () => {
    expect(
      connectMethods(
        integration({
          id: Integration.ID.make("example", { disableChecks: true }),
          name: "Example",
          methods: [
            { type: "env", names: ["EXAMPLE_KEY"] },
            { type: "key", label: "API key" },
            { type: "oauth", id: Integration.MethodID.make("account", { disableChecks: true }), label: "Account" },
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
          id: Integration.ID.make("example", { disableChecks: true }),
          name: "Example",
          connections: [
            { type: "env", name: "EXAMPLE_KEY" },
            {
              type: "credential",
              method: "key",
              id: Credential.ID.make("cred_1", { disableChecks: true }),
              label: "Work",
            },
          ],
        }),
      ),
    ).toEqual([
      { type: "credential", method: "key", id: Credential.ID.make("cred_1", { disableChecks: true }), label: "Work" },
    ])
  })
})

describe("connectionSummary", () => {
  test("shows credential labels and environment variables", () => {
    expect(
      connectionSummary(
        integration({
          id: Integration.ID.make("example", { disableChecks: true }),
          name: "Example",
          connections: [
            {
              type: "credential",
              method: "key",
              id: Credential.ID.make("cred_1", { disableChecks: true }),
              label: "Work",
            },
            { type: "env", name: "EXAMPLE_KEY" },
          ],
        }),
      ),
    ).toBe("Work, $EXAMPLE_KEY")
  })
})
