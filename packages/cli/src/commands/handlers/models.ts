import { OpenCode } from "@opencode/client"
import { Service } from "@opencode/client/effect/service"
import { Effect, Option } from "effect"
import { EOL } from "node:os"
import { Commands } from "../commands"
import { Runtime } from "../../framework/runtime"
import { ServerConnection } from "../../services/server-connection"

// Model metadata includes resolved provider settings that hold credentials (apiKey and friends).
// Recursively redact anything that looks like a secret before verbose mode prints it to stdout.
const redact = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(redact)
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {}
    for (const [key, item] of Object.entries(value)) {
      out[key] = /api.?key|secret|token|password/i.test(key) ? "***" : redact(item)
    }
    return out
  }
  return value
}

export default Runtime.handler(
  Commands.commands.models,
  Effect.fn("cli.models")(function* (input) {
    const server = yield* ServerConnection.resolve({
      server: Option.getOrUndefined(input.server),
      standalone: input.standalone,
    })
    const client = OpenCode.make({
      baseUrl: server.endpoint.url,
      headers: Service.headers(server.endpoint),
    })
    const response = input.refresh
      ? yield* Effect.promise(() => client.model.refresh({ location: { directory: process.cwd() } }))
      : yield* Effect.promise(() => client.model.list({ location: { directory: process.cwd() } }))
    if (input.verbose) {
      process.stdout.write(response.data.map((model) => JSON.stringify(redact(model), null, 2)).join(EOL) + EOL)
      return
    }
    const models = response.data
      .map((model) => `${model.providerID}/${model.id}`)
      .toSorted((a, b) => a.localeCompare(b))
    if (models.length > 0) process.stdout.write(models.join(EOL) + EOL)
  }),
)
