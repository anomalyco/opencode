import { EOL } from "node:os"
import { intro, outro } from "@clack/prompts"
import { Effect, Option } from "effect"
import {
  OpenCode,
  type IntegrationInfo,
  type IntegrationAttemptStatus,
  type IntegrationOAuthMethod,
  type McpServer,
  type OpenCodeClient,
} from "@opencode/client"
import { Commands } from "../../commands"
import { Runtime } from "../../../framework/runtime"
import { Service } from "@opencode/client/effect/service"
import { ServiceConfig } from "../../../services/service-config"
import { selectIntegration, type IntegrationChoice } from "../../../ui/integration-picker"
import { handlePromptErrors, prompt, requireInteractive } from "../../../ui/prompt"
import { answerForm } from "../auth/form"
import { oauthLogin } from "../auth/login"
import { loadIntegrations, request } from "../auth/shared"
import { resolveIntegration } from "./resolve"

const location = { directory: process.cwd() }

export default Runtime.handler(
  Commands.commands.mcp.commands.auth,
  Effect.fn("cli.mcp.auth")(function* (input) {
    const name = Option.getOrUndefined(input.name)
    if (!name) return yield* interactive().pipe(handlePromptErrors)
    const client = yield* createClient()
    return yield* authenticate(client, name)
  }),
)

const createClient = Effect.fn("cli.mcp.auth.client")(function* () {
  const endpoint = yield* Service.ensure(yield* ServiceConfig.options())
  return OpenCode.make({ baseUrl: endpoint.url, headers: Service.headers(endpoint) })
})

const interactive = Effect.fn("cli.mcp.auth.interactive")(function* () {
  yield* requireInteractive("Pass an MCP server name when running without an interactive terminal")
  intro("Authenticate an MCP server")
  const client = yield* createClient()
  const integrations = yield* loadIntegrations(client)
  const servers = yield* request((signal) => client.mcp.list({ location }, { signal }))
  const choices = mcpAuthChoices(servers.data, integrations)
  if (choices.length === 0)
    return yield* Effect.fail(
      new Error("No OAuth-capable remote MCP servers are configured. Add one with `opencode mcp add`"),
    )
  const id = yield* prompt<string>(() => selectIntegration(choices, "MCP server"))
  const integration = integrations.find((item) => item.id === id)
  const method = integration?.methods.find(
    (candidate): candidate is IntegrationOAuthMethod => candidate.type === "oauth",
  )
  if (!integration || !method) return yield* Effect.fail(new Error(`Integration not found: ${id}`))
  yield* oauthLogin(client, integration, method, yield* answerForm(method.form))
  outro("Done")
})

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
        },
      ]
    })
    .toSorted((a, b) => a.label.localeCompare(b.label) || a.value.localeCompare(b.value))
}

const authenticate = Effect.fn("cli.mcp.auth.authenticate")(function* (client: OpenCodeClient, name: string) {
  const integration = yield* resolveIntegration(client, name, location)
  if (!integration) return yield* Effect.fail(new Error(`MCP server "${name}" is not an OAuth-capable remote server`))
  const method = integration.methods.find(
    (candidate): candidate is IntegrationOAuthMethod => candidate.type === "oauth",
  )
  if (!method) return yield* Effect.fail(new Error(`MCP server "${name}" is not an OAuth-capable remote server`))

  const started = yield* Effect.promise(() =>
    client.integration.oauth.connect({ integrationID: integration.id, methodID: method.id, location }),
  )
  const attempt = started.data
  if (attempt.mode === "code")
    return yield* Effect.fail(new Error("This server requires manual code entry, which the CLI does not support"))

  process.stdout.write(attempt.instructions + EOL + attempt.url + EOL)

  const result = yield* poll(client, integration.id, attempt.attemptID)
  if (result.status === "complete") {
    process.stdout.write(`Authenticated with ${name}` + EOL)
    return
  }
  const reason = result.status === "failed" ? `: ${result.message}` : ""
  return yield* Effect.fail(new Error(`Authentication ${result.status}${reason}`))
})

const poll = (
  client: OpenCodeClient,
  integrationID: string,
  attemptID: string,
): Effect.Effect<Exclude<IntegrationAttemptStatus, { status: "pending" }>> =>
  Effect.gen(function* () {
    const status = yield* Effect.promise(() =>
      client.integration.oauth.status({ integrationID, attemptID, location }),
    ).pipe(Effect.map((result) => result.data))
    if (status.status === "pending") {
      yield* Effect.sleep("1 second")
      return yield* poll(client, integrationID, attemptID)
    }
    return status
  })
