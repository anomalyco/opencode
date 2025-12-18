import z from "zod"
import { Global } from "../global"
import { Log } from "../util/log"
import path from "path"
import fs from "fs/promises"
import { NamedError } from "@opencode-ai/util/error"
import { readableStreamToText } from "bun"
import { createRequire } from "module"
import { Lock } from "../util/lock"

export namespace BunProc {
  const log = Log.create({ service: "bun" })
  const req = createRequire(import.meta.url)

  type RunOptions = Bun.SpawnOptions.OptionsObject<any, any, any> & {
    timeoutMs?: number
  }

  export async function run(cmd: string[], options?: RunOptions) {
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
    const ms = options?.timeoutMs ?? Number(process.env.OPENCODE_BUN_TIMEOUT_MS ?? "0")
    const mode =
      ms > 0
        ? await Promise.race([
            result.exited.then(() => "exited" as const),
            Bun.sleep(ms).then(() => "timeout" as const),
          ])
        : ("exited" as const)

    if (mode === "timeout") {
      log.warn("timeout", {
        cmd: [which(), ...cmd],
        ms,
      })
      result.kill("SIGKILL")
      throw new Error(`Command timed out after ${ms}ms`)
    }

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
      const error = Object.assign(new Error(`Command failed with exit code ${result.exitCode}`), {
        stdout,
        stderr,
        exitCode: result.exitCode,
      })
      throw error
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
    const installed = await Bun.file(path.join(mod, "package.json")).exists()
    const pkgjson = Bun.file(path.join(Global.Path.cache, "package.json"))
    const parsed = await pkgjson.json().catch(async () => {
      const result = { dependencies: {} }
      await Bun.write(pkgjson.name!, JSON.stringify(result, null, 2))
      return result
    })
    const current = parsed.dependencies[pkg]
    if (version === "latest" && current && installed) return mod
    if (current === version && installed) return mod

    // Build command arguments
    const base = ["add", "--force", "--exact", "--cwd", Global.Path.cache]

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
    const ms = Number(process.env.OPENCODE_BUN_ADD_TIMEOUT_MS ?? "300000")
    const timeoutMs = Number.isFinite(ms) ? ms : 300000

    type RunError = Error & { stdout?: string; stderr?: string; exitCode?: number }
    const asRunError = (e: unknown): RunError | undefined => {
      if (!e) return
      if (typeof e !== "object") return
      if (!("message" in e)) return
      return e as RunError
    }

    const shouldResetCacheProject = (e: unknown) => {
      const err = asRunError(e)
      const out = [err?.stderr, err?.stdout].filter(Boolean).join("\n")
      if (out.includes(" - 404")) return true
      if (out.includes("Access token expired or revoked")) return true
      if (err?.message?.includes("timed out")) return true
      return false
    }

    const resetCacheProject = async () => {
      await fs.rm(path.join(Global.Path.cache, "bun.lock"), { force: true })
      await fs.rm(path.join(Global.Path.cache, "bun.lockb"), { force: true })
      await fs.rm(path.join(Global.Path.cache, "node_modules"), { recursive: true, force: true })
    }

    const runInstall = async (count: number = 1): Promise<void> => {
      log.info("bun install attempt", {
        pkg,
        version,
        attempt: count,
        total,
      })
      const args = count > 1 ? [...base, "--no-cache", pkg + "@" + version] : [...base, pkg + "@" + version]
      await BunProc.run(args, {
        cwd: Global.Path.cache,
        timeoutMs,
      }).catch(async (error) => {
        log.warn("bun install failed", {
          pkg,
          version,
          attempt: count,
          total,
          error,
        })
        if (count === 1 && shouldResetCacheProject(error)) {
          log.warn("bun install cache reset", {
            pkg,
            version,
          })
          await resetCacheProject()
          return runInstall(count + 1)
        }
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
