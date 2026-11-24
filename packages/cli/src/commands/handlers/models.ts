import { OpenCode } from "@opencode/client"
import { Service } from "@opencode/client/effect/service"
import { Copilot } from "@opencode/schema/copilot"
import { Effect, Schedule } from "effect"
import { EOL } from "node:os"
import { Commands } from "../commands"
import { Runtime } from "../../framework/runtime"
import { ServerConnection } from "../../services/server-connection"
import { waitForPlugins } from "../../services/plugin-startup"

export default Runtime.handler(
  Commands.commands.models,
  Effect.fn("cli.models")(function* () {
    const server = yield* ServerConnection.resolve()
    const client = OpenCode.make({
      baseUrl: server.endpoint.url,
      headers: Service.headers(server.endpoint),
    })
    const location = { directory: process.cwd() }
    yield* waitForPlugins(client, location.directory)
    // Plugins can publish models after activation. A one-shot command would miss those updates.
    const copilot = client.rpc(Copilot.Definition)
    yield* Effect.tryPromise((signal) => copilot.catalogReady(undefined, { location, signal })).pipe(
      Effect.repeat({ until: (ready) => ready, schedule: Schedule.spaced("100 millis") }),
      Effect.timeout("10 seconds"),
      Effect.ignore,
    )
    const response = yield* Effect.promise(() => client.model.list({ location }))
    const models = response.data
      .map((model) => `${model.providerID}/${model.id}`)
      .toSorted((a, b) => a.localeCompare(b))
    if (models.length > 0) process.stdout.write(models.join(EOL) + EOL)
  }),
)
