import { Option, Schema } from "effect"
import { builtinMainContext } from "@opencode/plugin/gui/builtin"
import type { Plugin } from "@opencode/plugin/gui/main"
import { Wsl } from "./contract"
import { createWslRuntime } from "./runtime"
import { createWslServersController, wslServerIdForDistro } from "./servers"
import { spawnWslSidecar } from "./sidecar"

// A record is kept when it names a distro; an id that is missing or not a non-empty string is derived from the distro.
const Distro = Schema.Struct({ distro: Schema.NonEmptyString })

const Id = Schema.Struct({ id: Schema.NonEmptyString })

const Saved = Schema.Struct({ servers: Schema.Array(Schema.Unknown) })

const setup: Plugin.MainSetup = (ctx) => {
  const cli = ctx.cli
  const packaged = ctx.app.packaged
  const desktopLog = ctx.log
  const t = ctx.t
  const runtime = createWslRuntime(t)

  // The distros main serves; stored before in the desktop settings file. Read leniently like that file: one bad record
  // must not drop the others.
  const saved = builtinMainContext(ctx).storage.store("servers", {
    schema: Saved,
    initial: { servers: [] },
    from: { settings: "wslServers" },
  })

  // Development builds of the desktop app can build the Linux CLI from this checkout.
  const local =
    packaged || !process.env.OPENCODE_DESKTOP_WSL_CLI_BUILD || !process.env.OPENCODE_DESKTOP_WSL_CLI_OUTPUT
      ? undefined
      : { script: process.env.OPENCODE_DESKTOP_WSL_CLI_BUILD, output: process.env.OPENCODE_DESKTOP_WSL_CLI_OUTPUT }

  const log = <Data extends Readonly<Record<string, unknown>>>(level: "info" | "error", message: string, data: Data) =>
    desktopLog.write(level, `[wsl] ${message}`, data)

  const controller = createWslServersController({
    cli: { version: cli.version },
    runtime,
    t,
    log,
    readServers: () =>
      saved.value.servers.flatMap((value) => {
        const record = Schema.decodeUnknownOption(Distro)(value)

        if (Option.isNone(record)) return []
        const distro = record.value.distro
        const id = Schema.decodeUnknownOption(Id)(value)

        return [{ id: Option.isSome(id) ? id.value.id : wslServerIdForDistro(distro), distro }]
      }),
    writeServers: (servers) => saved.set({ servers }),
    installCli: local
      ? async (distro) => {
          const { buildLocalWslCli } = await import("./local")
          const binary = await buildLocalWslCli({ ...local, version: cli.version })
          await runtime.installCli(distro, { version: cli.version, binary })
        }
      : (distro, build) => runtime.installCli(distro, build),
    spawnSidecar: (distro, signal) => {
      log("info", "spawning wsl sidecar", { distro })

      return spawnWslSidecar(distro, {
        runtime,
        t,
        packaged,
        signal,
        onLine: (line) => log("info", "wsl sidecar", { distro, stream: line.stream, text: line.text }),
      })
    },
  })

  const provider = ctx.provide(Wsl, {
    state: () => controller.getState(),
    probeRuntime: () => controller.probeRuntime(),
    refreshDistros: () => controller.refreshDistros(),
    installWsl: () => controller.installWsl(),
    installDistro: (input) => controller.installDistro(input.name),
    probeAddable: (input) => controller.probeAddable(input.distros),
    installOpencode: (input) => controller.installOpencode(input.name),
    addServer: (input) => controller.addServer(input.distro),
    removeServer: (input) => controller.removeServer(input.id),
    startServer: (input) => controller.startServer(input.id),
  })

  ctx.onCleanup(controller.subscribe(() => provider.changed()))
  // Finalizers run in reverse: the servers stop before the state stops being published.
  ctx.onCleanup(() => controller.stopServers())
  controller.startConfiguredServers()
}

export default setup
