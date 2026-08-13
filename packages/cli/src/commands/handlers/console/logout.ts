import { EOL } from "node:os"
import { Effect } from "effect"
import { OpenCode } from "@opencode-ai/client"
import { Service } from "@opencode-ai/client/effect/service"
import { Commands } from "../../commands"
import { Runtime } from "../../../framework/runtime"
import { ServiceConfig } from "../../../services/service-config"

const integrationID = "opencode"
const location = { directory: process.cwd() }

export default Runtime.handler(
  Commands.commands.console.commands.logout,
  Effect.fn("cli.console.logout")(function* () {
    const endpoint = yield* Service.ensure(yield* ServiceConfig.options())
    const client = OpenCode.make({ baseUrl: endpoint.url, headers: Service.headers(endpoint) })
    const found = yield* Effect.promise(() => client.integration.get({ integrationID, location }))
    const credentials = found.data?.connections.filter((connection) => connection.type === "credential") ?? []

    if (credentials.length === 0) {
      process.stdout.write("Not logged in" + EOL)
      return
    }

    yield* Effect.forEach(
      credentials,
      (connection) => Effect.promise(() => client.credential.remove({ credentialID: connection.id, location })),
      { discard: true },
    )
    process.stdout.write("Logged out from OpenCode Console" + EOL)
  }),
)
