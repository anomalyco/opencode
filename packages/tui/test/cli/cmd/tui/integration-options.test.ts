import { describe, expect, test } from "bun:test"
import type { IntegrationInfo } from "@opencode/client"
import {
  activeCredentialIDs,
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
    ).toEqual(["opencode", "openai", "anthropic", "mistral", "custom-z"])
  })

  test("folds OpenCode Go into one OpenCode row with account sign-in and both API keys", () => {
    const [row] = integrationOptions([
      integration({
        id: "opencode-go",
        name: "OpenCode Go",
        methods: [{ type: "key" }, { type: "env", names: ["OPENCODE_API_KEY"] }],
        connections: [{ type: "credential", method: "key", id: "cred_go", label: "Go key" }],
      }),
      integration({
        id: "opencode",
        name: "OpenCode Console",
        methods: [
          { type: "key", label: "API key (service account)" },
          { type: "oauth", id: "device", label: "OpenCode Console account" },
        ],
        connections: [{ type: "credential", method: "oauth", id: "cred_acme", label: "Acme" }],
      }),
    ])

    expect(row.name).toBe("OpenCode")
    expect(connectMethods(row).map((method) => method.label)).toEqual([
      "Sign in with your OpenCode account",
      "Use a Zen API key",
      "Use a Go API key",
    ])
    expect(credentialConnections(row).map((connection) => connection.id)).toEqual(["cred_acme", "cred_go"])
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
    ).toEqual(["github", "linear", "opencode", "openai"])
  })
})

describe("activeCredentialIDs", () => {
  test("keeps one active credential per integration in the OpenCode row", () => {
    const list = [
      integration({
        id: "opencode",
        name: "OpenCode Console",
        connections: [{ type: "credential", method: "oauth", id: "cred_acme", label: "Acme" }],
      }),
      integration({
        id: "opencode-go",
        name: "OpenCode Go",
        connections: [
          { type: "credential", method: "key", id: "cred_go2", label: "Go key 2" },
          { type: "credential", method: "key", id: "cred_go1", label: "Go key 1" },
        ],
      }),
      integration({
        id: "openai",
        name: "OpenAI",
        connections: [{ type: "credential", method: "key", id: "cred_openai", label: "Work" }],
      }),
    ]

    expect([...activeCredentialIDs(list, "opencode")]).toEqual(["cred_acme", "cred_go2"])
    expect([...activeCredentialIDs(list, "openai")]).toEqual(["cred_openai"])
  })
})

describe("connectMethods", () => {
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
  test("counts several connections", () => {
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
    ).toBe("2 connections")
  })
})
