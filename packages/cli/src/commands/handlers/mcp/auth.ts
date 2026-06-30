import { EOL } from "node:os"
import { Effect } from "effect"
import type { IntegrationAttemptStatus, IntegrationOAuthMethod, OpencodeClient } from "@opencode-ai/sdk/v2/client"
import { Commands } from "../../commands"
import { Runtime } from "../../../framework/runtime"
import { Daemon } from "../../../services/daemon"

const location = { directory: process.cwd() }

export default Runtime.handler(
  Commands.commands.mcp.commands.auth,
  Effect.fn("cli.mcp.auth")(function* (input) {
    const daemon = yield* Daemon.Service
    const client = yield* daemon.client()

    // Resolve through the MCP-owned integrationID rather than matching integration names: the shared
    // integration registry also holds provider/plugin integrations, whose names could collide with a server.
    const servers = yield* Effect.promise(() => client.v2.mcp.list({ location }))
    const server = (servers.data?.data ?? []).find((entry) => entry.name === input.name)
    if (!server) return yield* Effect.fail(new Error(`MCP server not found: ${input.name}`))
    const integrationID = server.integrationID
    if (!integrationID)
      return yield* Effect.fail(new Error(`MCP server "${input.name}" is not an OAuth-capable remote server`))
    const found = yield* Effect.promise(() => client.v2.integration.get({ integrationID, location }))
    const integration = found.data?.data
    if (!integration) return yield* Effect.fail(new Error(`Integration not found for MCP server: ${input.name}`))
    const method = integration.methods.find(
      (candidate): candidate is IntegrationOAuthMethod => candidate.type === "oauth",
    )
    if (!method) return yield* Effect.fail(new Error(`MCP server "${input.name}" is not an OAuth-capable remote server`))

    const started = yield* Effect.promise(() =>
      client.v2.integration.connect.oauth({ integrationID: integration.id, methodID: method.id, inputs: {}, location }),
    )
    const attempt = started.data?.data
    if (!attempt) return yield* Effect.fail(new Error(started.error?.message ?? "Failed to start OAuth attempt"))
    if (attempt.mode === "code")
      return yield* Effect.fail(new Error("This server requires manual code entry, which the CLI does not support"))

    process.stdout.write(attempt.instructions + EOL + attempt.url + EOL)

    const result = yield* poll(client, attempt.attemptID)
    if (result.status === "complete") {
      process.stdout.write(`Authenticated with ${input.name}` + EOL)
      return
    }
    const reason = result.status === "failed" ? `: ${result.message}` : ""
    return yield* Effect.fail(new Error(`Authentication ${result.status}${reason}`))
  }),
)

const poll = (
  client: OpencodeClient,
  attemptID: string,
): Effect.Effect<Exclude<IntegrationAttemptStatus, { status: "pending" }>> =>
  Effect.gen(function* () {
    const response = yield* Effect.promise(() => client.v2.integration.attempt.status({ attemptID, location }))
    const status = response.data?.data
    if (!status || status.status === "pending") {
      yield* Effect.sleep("1 second")
      return yield* poll(client, attemptID)
    }
    return status
  })
