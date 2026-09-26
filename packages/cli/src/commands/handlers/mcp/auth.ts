import { confirm, intro, log, outro } from "@clack/prompts"
import { Effect, Option } from "effect"
import { OpenCode, type IntegrationInfo, type IntegrationOAuthMethod, type McpServer } from "@opencode/client"
import { Commands } from "../../commands"
import { Runtime } from "../../../framework/runtime"
import { Service } from "@opencode/client/effect/service"
import { ServiceConfig } from "../../../services/service-config"
import { selectIntegration, type IntegrationChoice } from "../../../ui/integration-picker"
import { handlePromptErrors, prompt, requireInteractive } from "../../../ui/prompt"
import { answerForm } from "../auth/form"
import { oauthLogin } from "../auth/login"
import { loadIntegrations, request } from "../auth/shared"

const location = { directory: process.cwd() }

export default Runtime.handler(
  Commands.commands.mcp.commands.auth,
  Effect.fn("cli.mcp.auth")((input) => authenticate(Option.getOrUndefined(input.name)).pipe(handlePromptErrors)),
)

const authenticate = Effect.fn("cli.mcp.auth.run")(function* (name?: string) {
  if (!name) yield* requireInteractive("Pass an MCP server name when running without an interactive terminal")
  intro("Authenticate an MCP server")
  const endpoint = yield* Service.ensure(yield* ServiceConfig.options())
  const client = OpenCode.make({ baseUrl: endpoint.url, headers: Service.headers(endpoint) })
  const integrations = yield* loadIntegrations(client)
  const servers = yield* request((signal) => client.mcp.list({ location }, { signal }))
  const choices = mcpAuthChoices(servers.data, integrations)
  if (!name && choices.length === 0) {
    log.warn("No OAuth-capable MCP servers configured")
    log.info(
      `Remote MCP servers support OAuth by default. Add one with \`opencode mcp add\` or in opencode.json:\n${exampleConfig}`,
    )
    outro("Done")
    return
  }

  const server = name ? servers.data.find((item) => item.name === name) : undefined
  if (name && !server) return yield* Effect.fail(new Error(`MCP server not found: ${name}`))
  const integrationID = server
    ? server.integrationID
    : yield* prompt<string>(() => selectIntegration(choices, "MCP server"))
  const integration = integrations.find((item) => item.id === integrationID)
  const method = integration?.methods.find(
    (candidate): candidate is IntegrationOAuthMethod => candidate.type === "oauth",
  )
  if (!integration || !method)
    return yield* Effect.fail(new Error(`MCP server "${name}" is not an OAuth-capable remote server`))

  if (integration.connections.length > 0) {
    const status = servers.data.find((item) => item.integrationID === integration.id)?.status.status
    if (status === "needs_auth") log.warn(`${integration.name} has expired credentials. Re-authenticating...`)
    if (status !== "needs_auth" && process.stdin.isTTY && process.stdout.isTTY) {
      const again = yield* prompt<boolean>(() =>
        confirm({ message: `${integration.name} already has valid credentials. Re-authenticate?` }),
      )
      if (!again) {
        outro("Cancelled")
        return
      }
    }
  }

  yield* oauthLogin(client, integration, method, yield* answerForm(method.form))
  // Re-authenticating replaces the previous sign-in rather than adding an account; the old
  // credentials are only removed once the new one is stored, so a failed attempt keeps them.
  yield* Effect.forEach(
    integration.connections.filter((connection) => connection.type === "credential"),
    (connection) => request((signal) => client.credential.remove({ credentialID: connection.id }, { signal })),
    { discard: true },
  )
  outro("Done")
})

const exampleConfig = `
  "mcp": {
    "my-server": {
      "type": "remote",
      "url": "https://example.com/mcp"
    }
  }`

// Choices carry the server-owned integration ID so provider integrations with colliding names never match.
export function mcpAuthChoices(servers: McpServer[], integrations: IntegrationInfo[]): IntegrationChoice[] {
  const byID = new Map(integrations.map((integration) => [integration.id, integration]))
  return servers
    .flatMap((server) => {
      const integration = server.integrationID ? byID.get(server.integrationID) : undefined
      if (!integration?.methods.some((method) => method.type === "oauth")) return []
      return [
        {
          value: integration.id,
          label: server.name,
          category: "MCP" as const,
          connected: integration.connections.length > 0,
          hint: statusHint(server.status),
        },
      ]
    })
    .toSorted((a, b) => a.label.localeCompare(b.label) || a.value.localeCompare(b.value))
}

function statusHint(status: McpServer["status"]) {
  if (status.status === "needs_auth") return "needs authentication"
  if (status.status === "failed" || status.status === "disabled") return status.status
  return undefined
}
