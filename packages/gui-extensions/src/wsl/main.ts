import { Schema } from "effect"
import { Cli, MainApp, MainStorage, type Setup } from "../sdk/main"
import { Wsl, type WslServerConfig } from "./contract"
import { createWslRuntime } from "./runtime"
import { createWslServersController, wslServerIdForDistro } from "./servers"
import { spawnWslSidecar } from "./sidecar"

// Read leniently like the settings file it migrates from: one bad record must not drop the others.
const Stored = Schema.Struct({ servers: Schema.Array(Schema.Unknown) })

const setup: Setup = (ctx) => {
  const cli = ctx.use(Cli)
  const app = ctx.use(MainApp)
  const packaged = app.packaged
  const t = ctx.t
  const runtime = createWslRuntime(t)
  const saved = ctx
    .use(MainStorage)
    .store("servers", { schema: Stored, initial: { servers: [] }, from: "settings:wslServers" })
  // Development builds of the desktop app can build the Linux CLI from this checkout.
  const local =
    packaged || !process.env.OPENCODE_DESKTOP_WSL_CLI_BUILD || !process.env.OPENCODE_DESKTOP_WSL_CLI_OUTPUT
      ? undefined
      : { script: process.env.OPENCODE_DESKTOP_WSL_CLI_BUILD, output: process.env.OPENCODE_DESKTOP_WSL_CLI_OUTPUT }
  const log = (level: "info" | "error", message: string, data: Record<string, unknown>) =>
    app.log(level, `[wsl] ${message}`, data)
  const controller = createWslServersController({
    cli: { version: cli.version },
    runtime,
    t,
    log,
    readServers: () =>
      saved.get().servers.flatMap((value) => {
        if (!value || typeof value !== "object") return []
        const record = value as Record<string, unknown>
        const distro = typeof record.distro === "string" && record.distro.length > 0 ? record.distro : null
        if (!distro) return []
        const id = typeof record.id === "string" && record.id.length > 0 ? record.id : wslServerIdForDistro(distro)
        return [{ id, distro } satisfies WslServerConfig]
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
  const provided = ctx.provide(Wsl, {
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
  ctx.cleanup(controller.subscribe(() => provided.changed()))
  controller.startConfiguredServers()
  return () => controller.stopServers()
}

export default setup
