import { EOL } from "node:os"
import { Effect } from "effect"
import { OpenCode } from "@opencode-ai/client"
import { Service } from "@opencode-ai/client/effect/service"
import { Commands } from "../../commands"
import { Runtime } from "../../../framework/runtime"
import { ServiceConfig } from "../../../services/service-config"

export default Runtime.handler(
  Commands.commands.plugin.commands.list,
  Effect.fn("cli.plugin.list")(function* () {
    const options = yield* ServiceConfig.options()
    const found = yield* Service.discover(options)
    const endpoint = found ?? (yield* Service.ensure(options))
    const client = OpenCode.make({ baseUrl: endpoint.url, headers: Service.headers(endpoint) })
    const response = yield* Effect.promise(() => client.plugin.list({ location: { directory: process.cwd() } }))
    const plugins = response.data.toSorted((a, b) => a.id.localeCompare(b.id))
    if (plugins.length === 0) {
      process.stdout.write("No plugins loaded" + EOL)
      return
    }
    process.stdout.write(plugins.map((plugin) => plugin.id).join(EOL) + EOL)
  }),
)
