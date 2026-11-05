import { expect, test } from "bun:test"
import type { ConfigEntry, IntegrationInfo } from "@opencode/client"
import { disabledBy, loginChoices } from "../src/commands/handlers/auth/login"

const integration = (value: Partial<IntegrationInfo> & Pick<IntegrationInfo, "id" | "name">): IntegrationInfo => ({
  methods: [{ type: "key" }],
  connections: [],
  ...value,
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

test("reports the config file that disables a provider", () => {
  const document = (path: string, policies: { resource: string; effect: "allow" | "deny" }[]): ConfigEntry => ({
    type: "document",
    path,
    info: { policies: policies.map((policy) => ({ action: "provider.use", ...policy })) },
  })
  const global = document("/home/me/.config/opencode/opencode.jsonc", [{ resource: "opencode-go", effect: "deny" }])

  expect(disabledBy([global], "opencode-go")?.path).toBe("/home/me/.config/opencode/opencode.jsonc")
  expect(disabledBy([global], "openai")).toBeUndefined()
  // Within a document the last statement wins; across documents the earliest-loaded one does, as in core.
  expect(
    disabledBy(
      [
        document("/a", [
          { resource: "opencode-go", effect: "deny" },
          { resource: "opencode-go", effect: "allow" },
        ]),
      ],
      "opencode-go",
    ),
  ).toBeUndefined()
  expect(
    disabledBy([document("/managed", [{ resource: "opencode-go", effect: "allow" }]), global], "opencode-go"),
  ).toBeUndefined()
  // A later wildcard allow wins, as in core.
  expect(
    disabledBy(
      [
        document("/c", [
          { resource: "opencode-go", effect: "deny" },
          { resource: "*", effect: "allow" },
        ]),
      ],
      "opencode-go",
    ),
  ).toBeUndefined()
  // Wildcards cross "/" as in core, so a URL-shaped ID is still covered by a later allow.
  expect(
    disabledBy(
      [
        document("/d", [
          { resource: "https://llm.example.com/v1", effect: "deny" },
          { resource: "https://*", effect: "allow" },
        ]),
      ],
      "https://llm.example.com/v1",
    ),
  ).toBeUndefined()
  // enabled_providers' wildcard deny also covers integrations that supply no provider.
  expect(disabledBy([document("/b", [{ resource: "*", effect: "deny" }])], "opencode-go")).toBeUndefined()
})
