import { expect, test } from "bun:test"
import path from "node:path"
import type { IntegrationInfo, McpServer } from "@opencode/client"
import { mcpAuthChoices } from "../src/commands/handlers/mcp/auth"

const server = (name: string, integrationID?: string): McpServer => ({
  name,
  integrationID,
  status: { status: "pending" },
})

const integration = (id: string, methods: IntegrationInfo["methods"], connected = false): IntegrationInfo => ({
  id,
  name: id,
  methods,
  connections: connected ? [{ type: "credential", method: "oauth", id: "cred_1", label: "Work" }] : [],
})

test("offers only OAuth-capable MCP servers by their server identity", () => {
  expect(
    mcpAuthChoices(
      [
        server("Linear", "mcp_linear"),
        server("Local"),
        server("API key only", "mcp_key"),
        server("GitHub", "mcp_github"),
        server("Unresolved", "mcp_missing"),
      ],
      [
        integration("mcp_linear", [{ type: "oauth", id: "login", label: "Linear" }], true),
        integration("mcp_github", [{ type: "oauth", id: "login", label: "GitHub" }]),
        integration("mcp_key", [{ type: "key" }]),
        integration("Linear", [{ type: "oauth", id: "login", label: "A provider with a colliding name" }]),
      ],
    ),
  ).toEqual([
    { value: "mcp_github", label: "GitHub", category: "MCP", connected: false },
    { value: "mcp_linear", label: "Linear", category: "MCP", connected: true },
  ])
})

test("mcp auth accepts an optional server name and rejects no-name noninteractive calls before connecting", async () => {
  const cli = (args: string[]) =>
    Bun.spawn([process.execPath, "run", "src/index.ts", "mcp", "auth", ...args], {
      cwd: path.join(import.meta.dir, ".."),
      stdout: "pipe",
      stderr: "pipe",
    })
  const help = cli(["--help"])
  expect(await new Response(help.stdout).text()).toContain("opencode mcp auth [flags] [<name>]")
  expect(await help.exited).toBe(0)

  const missing = cli([])
  expect(await new Response(missing.stdout).text()).toContain(
    "Pass an MCP server name when running without an interactive terminal",
  )
  expect(await new Response(missing.stderr).text()).toBe("")
  expect(await missing.exited).toBe(1)
})
