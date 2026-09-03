import { EOL } from "node:os"
import path from "node:path"
import { Effect } from "effect"
import { OpenCode, type PluginInfo } from "@opencode-ai/client"
import { Service } from "@opencode-ai/client/effect/service"
import { Commands } from "../../commands"
import { Runtime } from "../../../framework/runtime"
import { ServiceConfig } from "../../../services/service-config"
import { Config } from "../../../config"
import { Global } from "@opencode-ai/util/global"
import { Npm } from "@opencode-ai/util/npm"
import { Host } from "@opencode-ai/plugin/host"
import { fileURLToPath } from "node:url"
import { discoverPluginTargets, localPluginDirectories, localSource } from "@opencode-ai/tui/plugin/discovery"

export default Runtime.handler(
  Commands.commands.plugin.commands.list,
  Effect.fn("cli.plugin.list")(function* (input) {
    const endpoint = yield* Service.ensure(yield* ServiceConfig.options())
    const client = OpenCode.make({ baseUrl: endpoint.url, headers: Service.headers(endpoint) })
    const response = yield* Effect.promise(() => client.plugin.list({ location: { directory: process.cwd() } }))
    const config = yield* Config.Service
    const global = yield* Global.Service
    const info = yield* config.get()
    const discovered = yield* Effect.promise(() =>
      localPluginDirectories(process.cwd(), global.config).then(discoverPluginTargets),
    )
    const npm = yield* Npm.Service
    const configured = yield* Effect.forEach([...(info.plugins ?? []), ...discovered], (entry) =>
      Effect.gen(function* () {
        const target = typeof entry === "string" ? entry : entry.package
        if (target.startsWith("-") || target === "*" || target.endsWith(".*") || target.startsWith("opencode."))
          return []
        const local = localSource(target, path.dirname(config.path))
        if (local) {
          const directory = fileURLToPath(local)
          const entrypoints = Host.resolve({ directory })
          return entrypoints.tui ? [{ target: directory, version: "local" }] : []
        }
        if (!(yield* Effect.promise(() => Npm.isInstallablePackage(target)))) return []
        const installed = yield* npm.resolve(target)
        if (!Host.resolve(installed).tui) return []
        return [{ target, version: installed.version }]
      }),
    )
    const output = format(response.data, configured.flat(), input.builtin)
    if (!output) {
      process.stdout.write("No plugins found" + EOL)
      return
    }
    process.stdout.write(output + EOL)
  }),
)

export function format(
  plugins: readonly PluginInfo[],
  tui: ReadonlyArray<{ readonly target: string; readonly version?: string }>,
  builtin = false,
) {
  const server = plugins
    .filter((plugin) => builtin || plugin.source.type !== "builtin")
    .map((plugin) => ({
      id: plugin.id ?? "-",
      version:
        plugin.source.type === "package"
          ? (plugin.source.version ?? "-")
          : plugin.source.type === "local"
            ? "local"
            : "-",
      target:
        plugin.source.type === "package"
          ? plugin.source.target
          : plugin.source.type === "local"
            ? plugin.source.path
            : plugin.source.type,
    }))
  const targets = tui
    .filter(
      (item) =>
        !plugins.some((plugin) =>
          plugin.source.type === "package"
            ? plugin.source.target === item.target
            : plugin.source.type === "local" &&
              (plugin.source.path === item.target ||
                (plugin.features.tui && path.dirname(plugin.source.path) === item.target)),
        ),
    )
    .filter((plugin, index, all) => all.findIndex((candidate) => candidate.target === plugin.target) === index)
    .map((plugin) => ({ id: "-", version: plugin.version ?? "-", target: plugin.target }))
  const rows = [...server, ...targets]
    .toSorted((a, b) => a.id.localeCompare(b.id) || a.target.localeCompare(b.target))
    .map((item) => [
      item.id,
      /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i.test(item.version) ? item.version.slice(0, 7) : item.version,
      item.target,
    ])
  if (!rows.length) return ""
  const table = [["ID", "VERSION", "SOURCE"], ...rows]
  const widths = [0, 1].map((index) => Math.max(...table.map((row) => row[index].length)))
  return table.map((row) => `${row[0].padEnd(widths[0])}  ${row[1].padEnd(widths[1])}  ${row[2]}`).join(EOL)
}
