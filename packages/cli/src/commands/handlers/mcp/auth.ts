import { EOL } from "node:os"
import { Effect } from "effect"
import {
  createOpencodeClient,
  type IntegrationAttemptStatus,
  type IntegrationOAuthMethod,
  type OpencodeClient,
} from "@opencode-ai/sdk/v2/client"
import { Commands } from "../../commands"
import { Runtime } from "../../../framework/runtime"
import { Service } from "@opencode-ai/client/effect"
import { ServiceConfig } from "../../../services/service-config"
import { resolveIntegration } from "./resolve"

const location = { directory: process.cwd() }

export default Runtime.handler(
  Commands.commands.mcp.commands.auth,
  Effect.fn("cli.mcp.auth")(function* (input) {
    const options = yield* ServiceConfig.options()
    const found = yield* Service.discover(options)
    const endpoint = found ?? (yield* Service.start(options))
    const client = createOpencodeClient({ baseUrl: endpoint.url, headers: Service.headers(endpoint) })

    const integration = yield* resolveIntegration(client, input.name, location)
    if (!integration)
      return yield* Effect.fail(new Error(`MCP server "${input.name}" is not an OAuth-capable remote server`))
    const method = integration.methods.find(
      (candidate): candidate is IntegrationOAuthMethod => candidate.type === "oauth",
    )
    if (!method)
      return yield* Effect.fail(new Error(`MCP server "${input.name}" is not an OAuth-capable remote server`))

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
