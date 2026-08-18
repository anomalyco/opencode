import { createWslIpc } from "./ipc"

type Cli = {
  version: string
  wslBuild?: { script: string; output: string }
}

type Logger = {
  log(message: string, meta?: unknown): void
  error(message: string, meta?: unknown): void
}

export async function startWsl(cli: Cli, logger: Logger) {
  if (process.platform !== "win32") return { ipc: createWslIpc(), start: () => {}, stop: async () => {} }

  const { createWslServersController } = await import("./servers")
  const { spawnWslSidecar } = await import("./sidecar")
  const local = cli.wslBuild
  const controller = createWslServersController({
    cli: { version: cli.version },
    installCli: local
      ? async (distro) => {
          const { buildLocalWslCli } = await import("./local")
          const { installWslCli } = await import("./runtime")
          await installWslCli(distro, {
            version: cli.version,
            binary: await buildLocalWslCli({ ...local, version: cli.version }),
          })
        }
      : undefined,
    spawnSidecar: async (distro) => {
      logger.log("spawning wsl sidecar", { distro })
      return spawnWslSidecar(distro, {
        onLine: (line) => logger.log("wsl sidecar", { distro, stream: line.stream, text: line.text }),
      })
    },
    logger: {
      log: (message, meta) => logger.log(message, meta),
      error: (message, meta) => logger.error(message, meta),
    },
  })
  return {
    ipc: createWslIpc(controller),
    start: () => controller.startConfiguredServers(),
    stop: () => controller.stopServers(),
  }
}
