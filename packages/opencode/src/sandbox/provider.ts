import { which } from "../util/which"
import { Glob } from "bun"
import fs from "fs"
import path from "path"
import os from "os"

export interface SandboxOptions {
  cwd: string
  env: NodeJS.ProcessEnv
  envWhitelist?: string[]
  networkDomains?: string[]
  denyWorkspacePatterns?: string[]
  denyBinaries?: string[]
}

export abstract class SandboxProvider {
  abstract readonly name: string
  abstract isAvailable(): boolean
  abstract wrap(
    shell: string,
    command: string,
    options: SandboxOptions,
  ): { executable: string; args: string[]; env?: NodeJS.ProcessEnv; cleanup?: () => void }
}

export class SrtProvider extends SandboxProvider {
  name = "srt"

  isAvailable(): boolean {
    return which("srt") !== null
  }

  wrap(shell: string, command: string, options: SandboxOptions) {
    const id = Math.random().toString(36).substring(2, 10)
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "opencode-srt-"))
    const settingsFile = path.join(tmpDir, `srt-settings-${id}.json`)

    const domainsRaw = options.env["OPENCODE_SANDBOX_DOMAINS"]
    const allowedDomains = options.networkDomains ?? (domainsRaw ? domainsRaw.split(",").map(d => d.trim()).filter(Boolean) : [])

    const denyReadPaths = [os.homedir()]
    const denyWritePaths: string[] = []

    if (options.denyWorkspacePatterns) {
      for (const pattern of options.denyWorkspacePatterns) {
        try {
          const glob = new Glob(pattern)
          for (const file of glob.scanSync({ cwd: options.cwd })) {
            const absolutePath = path.join(options.cwd, file)
            denyReadPaths.push(absolutePath)
            denyWritePaths.push(absolutePath)
          }
        } catch (e) {
          // Ignore invalid globs
        }
      }
    }

    if (options.denyBinaries) {
      for (const binary of options.denyBinaries) {
        if (binary.startsWith("/")) {
          denyReadPaths.push(binary)
        } else {
          const absolutePath = which(binary)
          if (absolutePath) {
            denyReadPaths.push(absolutePath)
          }
        }
      }
    }

    const config = {
      network: {
        // If empty, force the proxy engine to initialize by providing a dummy domain to enforce air-gapping
        allowedDomains: allowedDomains.length === 0 ? ["sandbox.local"] : allowedDomains,
        deniedDomains: [],
      },
      filesystem: {
        denyRead: denyReadPaths,
        allowRead: [options.cwd, "/tmp"],
        allowWrite: [options.cwd, "/tmp"],
        denyWrite: denyWritePaths,
      },
    }

    fs.writeFileSync(settingsFile, JSON.stringify(config, null, 2))

    const args = ["--settings", settingsFile, shell, "-c", command]

    const safeEnv: NodeJS.ProcessEnv = {}
    const whitelist = options.envWhitelist ?? ["PATH", "HOME", "TERM", "LANG", "USER", "SHELL", "TMPDIR", "TMP", "EDITOR"]
    for (const key of whitelist) {
      if (options.env[key] !== undefined) {
        safeEnv[key] = options.env[key]
      }
    }

    return {
      executable: "srt",
      args,
      env: safeEnv,
      cleanup: () => {
        try {
          fs.rmSync(tmpDir, { recursive: true, force: true })
        } catch (e) {
          // Ignore failures on cleanup
        }
      },
    }
  }
}

let providerInstance: SandboxProvider | undefined

export function getSandboxProvider(name?: string): SandboxProvider {
  if (providerInstance && (!name || providerInstance.name === name)) {
    return providerInstance
  }

  let provider: SandboxProvider
  if (name && name !== "srt") {
    throw new Error(`The sandbox provider '${name}' is unsupported. Only 'srt' is available.`)
  }
  provider = new SrtProvider()

  if (!provider.isAvailable()) {
    throw new Error(
      `Sandboxing is enabled, but the required provider '${provider.name}' is not installed or available in PATH.`,
    )
  }

  providerInstance = provider
  return providerInstance
}
