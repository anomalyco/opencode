import type { Subprocess } from "bun"
import { dirname } from "node:path"
import { findOpencodeLaunch, type OpencodeLaunch } from "./paths"

const forwardedSignals = ["SIGINT", "SIGTERM", "SIGHUP"] as const

function spawnOpencode(launch: OpencodeLaunch, args: string[]) {
  if (launch.kind === "binary") {
    return Bun.spawn([launch.path, ...args], {
      stdin: "inherit",
      stdout: "inherit",
      stderr: "inherit",
    })
  }

  return Bun.spawn(["bun", "run", "--conditions=browser", launch.entry, ...args], {
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  })
}

export function runOpencode(exePath: string, args: string[]) {
  const launch = findOpencodeLaunch(dirname(exePath))
  const child = spawnOpencode(launch, args)

  const forwarders = new Map<string, () => void>()
  for (const signal of forwardedSignals) {
    const handler = () => {
      try {
        child.kill()
      } catch {
        // ignore
      }
    }
    forwarders.set(signal, handler)
    process.on(signal, handler)
  }

  return new Promise<number>((resolve) => {
    void child.exited.then((code) => {
      for (const [signal, handler] of forwarders) {
        process.removeListener(signal, handler)
      }
      resolve(code ?? 0)
    })
  })
}
