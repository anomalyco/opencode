import { EOL } from "node:os"
import { Effect } from "effect"
import { OpenCode, type PluginInfo } from "@opencode-ai/client"
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
    const plugins = response.data.toSorted((a, b) => name(a).localeCompare(name(b)))
    if (plugins.length === 0) {
      process.stdout.write("No plugins loaded" + EOL)
      return
    }
    process.stdout.write(plugins.map(name).join(EOL) + EOL)
  }),
)

function name(plugin: PluginInfo) {
  if (plugin.id) return plugin.id
  if (plugin.source.type === "package") return plugin.source.package
  if (plugin.source.type === "local") return plugin.source.path
  return plugin.source.type
}
