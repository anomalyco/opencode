import { EOL } from "node:os"
import { Effect } from "effect"
import { Service } from "@opencode-ai/client/effect/service"
import { OpenCode, type IntegrationCommandStatusOutput, type OpenCodeClient } from "@opencode-ai/client/promise"
import { Commands } from "../../commands"
import { Runtime } from "../../../framework/runtime"
import { ServiceConfig } from "../../../services/service-config"

const location = { directory: process.cwd() }

export default Runtime.handler(
  Commands.commands.auth.commands.login,
  Effect.fn("cli.auth.login")(function* (input) {
    process.stdout.write("Logging in..." + EOL + EOL)
    const endpoint = yield* Service.ensure(yield* ServiceConfig.options())
    const client = OpenCode.make({ baseUrl: endpoint.url, headers: Service.headers(endpoint) })
    yield* request(() => client.integration.wellknown.add({ url: input.url, location }))
    const integrationID = input.url.replace(/\/+$/, "")
    const started = yield* request(() =>
      client.integration.command.connect({ integrationID, methodID: "login", location }),
    )
    yield* Effect.addFinalizer(() =>
      request(() =>
        client.integration.command.cancel({ integrationID, attemptID: started.data.attemptID, location }),
      ).pipe(Effect.ignore),
    )

    const status = yield* wait(client, integrationID, started.data.attemptID)
    if (status.status === "failed") return yield* Effect.fail(new Error(status.message))
    if (status.status === "expired") return yield* Effect.fail(new Error("Authentication expired"))
    process.stdout.write("Logged in" + EOL)
  }),
)

const wait = (
  client: OpenCodeClient,
  integrationID: string,
  attemptID: string,
  shown = false,
): Effect.Effect<Exclude<IntegrationCommandStatusOutput["data"], { status: "pending" }>, unknown> =>
  Effect.gen(function* () {
    const response = yield* request(() => client.integration.command.status({ integrationID, attemptID, location }))
    if (response.data.status !== "pending") return response.data
    const output = response.data.message?.trim()
    if (!shown && output) process.stdout.write(output + EOL + EOL)
    yield* Effect.sleep(500)
    return yield* wait(client, integrationID, attemptID, shown || !!output)
  })

function request<A>(task: () => Promise<A>) {
  return Effect.tryPromise({ try: task, catch: (cause) => cause })
}
