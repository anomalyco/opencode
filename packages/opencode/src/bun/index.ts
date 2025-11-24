import z from "zod"
import { Global } from "../global"
import { Log } from "../util/log"
import path from "path"
import { NamedError } from "@opencode-ai/util/error"
import { readableStreamToText } from "bun"
import { createRequire } from "module"
import { Lock } from "../util/lock"

export namespace BunProc {
  const log = Log.create({ service: "bun" })
  const req = createRequire(import.meta.url)

  export async function run(cmd: string[], options?: Bun.SpawnOptions.OptionsObject<any, any, any>) {
    log.info("running", {
      cmd: [which(), ...cmd],
      ...options,
    })
    const result = Bun.spawn([which(), ...cmd], {
      ...options,
      stdout: "pipe",
      stderr: "pipe",
      env: {
        ...process.env,
        ...options?.env,
        BUN_BE_BUN: "1",
      },
    })
    const code = await result.exited
    const stdout = result.stdout
      ? typeof result.stdout === "number"
        ? result.stdout
        : await readableStreamToText(result.stdout)
      : undefined
    const stderr = result.stderr
      ? typeof result.stderr === "number"
        ? result.stderr
        : await readableStreamToText(result.stderr)
      : undefined
    log.info("done", {
      code,
      stdout,
      stderr,
    })
    if (code !== 0) {
      throw new Error(`Command failed with exit code ${result.exitCode}`)
    }
    return result
  }

  export function which() {
    return process.execPath
  }

  export const InstallFailedError = NamedError.create(
    "BunInstallFailedError",
    z.object({
      pkg: z.string(),
      version: z.string(),
    }),
  )

  export async function install(pkg: string, version = "latest") {
    // Use lock to ensure only one install at a time
    using _ = await Lock.write("bun-install")

    const mod = path.join(Global.Path.cache, "node_modules", pkg)
    const pkgjson = Bun.file(path.join(Global.Path.cache, "package.json"))
    const parsed = await pkgjson.json().catch(async () => {
      const result = { dependencies: {} }
      await Bun.write(pkgjson.name!, JSON.stringify(result, null, 2))
      return result
    })
    if (parsed.dependencies[pkg] === version) return mod

    // Build command arguments
    const args = ["add", "--force", "--exact", "--cwd", Global.Path.cache, pkg + "@" + version]

    // Let Bun handle registry resolution:
    // - If .npmrc files exist, Bun will use them automatically
    // - If no .npmrc files exist, Bun will default to https://registry.npmjs.org
    // - No need to pass --registry flag
    log.info("installing package using Bun's default registry resolution", {
      pkg,
      version,
    })

    const total = 3
    const wait = 500

    const runInstall = async (count: number = 1): Promise<void> => {
      log.info("bun install attempt", {
        pkg,
        version,
        attempt: count,
        total,
      })
      await BunProc.run(args, {
        cwd: Global.Path.cache,
      }).catch(async (error) => {
        log.warn("bun install failed", {
          pkg,
          version,
          attempt: count,
          total,
          error,
        })
        if (count >= total) {
          throw new InstallFailedError(
            { pkg, version },
            {
              cause: error,
            },
          )
        }
        const delay = wait * count
        log.info("bun install retrying", {
          pkg,
          version,
          next: count + 1,
          delay,
        })
        await Bun.sleep(delay)
        return runInstall(count + 1)
      })
    }

    await runInstall()

    parsed.dependencies[pkg] = version
    await Bun.write(pkgjson.name!, JSON.stringify(parsed, null, 2))
    return mod
  }

  export async function resolve(pkg: string) {
    const local = workspace(pkg)
    if (local) return local
    const dir = path.join(Global.Path.cache, "node_modules", pkg)
    const pkgjson = Bun.file(path.join(dir, "package.json"))
    const exists = await pkgjson.exists()
    if (exists) return dir
  }

  function workspace(pkg: string) {
    try {
      const target = req.resolve(`${pkg}/package.json`)
      return path.dirname(target)
    } catch {
      return
    }
  }
}
