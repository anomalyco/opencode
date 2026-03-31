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
    const domains = options.networkDomains ?? (domainsRaw ? domainsRaw.split(",").map(d => d.trim()).filter(Boolean) : [])

    // Resolve workspace patterns to absolute paths for blocking.
    const denyWrite: string[] = []
    const denyRead = [os.homedir()]

    if (options.denyWorkspacePatterns) {
      for (const pattern of options.denyWorkspacePatterns) {
        try {
          const glob = new Glob(pattern)
          for (const file of glob.scanSync({ cwd: options.cwd, dot: true })) {
            const absolutePath = path.resolve(options.cwd, file)
            denyWrite.push(absolutePath)
            denyRead.push(absolutePath)
          }
        } catch (_) {}
      }
    }

    if (options.denyBinaries) {
      for (const binary of options.denyBinaries) {
        if (binary.startsWith("/")) {
          denyRead.push(binary)
        } else {
          const abs = which(binary)
          if (abs) denyRead.push(abs)
        }
      }
    }

    const config = {
      network: {
        allowedDomains: domains.length === 0 ? ["sandbox.local"] : domains,
        deniedDomains: [],
      },
      filesystem: {
        denyRead,
        allowRead: [options.cwd, "/tmp"],
        allowWrite: [options.cwd, "/tmp"],
        denyWrite,
      },
    }

    fs.writeFileSync(settingsFile, JSON.stringify(config, null, 2))
    // Save a copy for debugging
    try { fs.writeFileSync("/tmp/opencode-last-srt-settings.json", JSON.stringify(config, null, 2)) } catch (_) {}

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
        try { fs.rmSync(tmpDir, { recursive: true, force: true }) } catch (_) {}
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
