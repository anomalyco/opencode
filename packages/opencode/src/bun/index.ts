import z from "zod"
import { Global } from "../global"
import { Log } from "../util/log"
import path from "path"
import { Filesystem } from "../util/filesystem"
import { NamedError } from "@opencode-ai/util/error"
import { readableStreamToText } from "bun"
import { Lock } from "../util/lock"
import { PackageRegistry } from "./registry"
import { proxied } from "@/util/proxied"

export namespace BunProc {
  const log = Log.create({ service: "bun" })

  interface PackageJson {
    dependencies?: Record<string, string>
    opencode?: {
      providers?: Record<string, string>
    }
  }

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

  async function readPackageJson(): Promise<PackageJson> {
    const pkgjsonPath = path.join(Global.Path.cache, "package.json")
    return Filesystem.readJson<PackageJson>(pkgjsonPath).catch(() => ({}))
  }

  async function writePackageJson(parsed: PackageJson) {
    const pkgjsonPath = path.join(Global.Path.cache, "package.json")
    await Filesystem.writeJson(pkgjsonPath, parsed)
  }

  async function track(provider: string, pkg: string) {
    const parsed = await readPackageJson()
    if (!parsed.opencode) parsed.opencode = {}
    if (!parsed.opencode.providers) parsed.opencode.providers = {}
    parsed.opencode.providers[provider] = pkg
    await writePackageJson(parsed)
  }

  async function cleanup(provider: string, oldPkg: string) {
    const parsed = await readPackageJson()
    const providers = parsed.opencode?.providers ?? {}
    const used = Object.entries(providers).some(([p, name]) => p !== provider && name === oldPkg)
    if (used) return
    log.info("removing unused package", { pkg: oldPkg })
    await BunProc.run(["remove", "--cwd", Global.Path.cache, oldPkg]).catch(() => {})
  }

  async function resolveVersion(mod: string, version: string) {
    if (version !== "latest") return version
    const pkg = await Filesystem.readJson<{ version?: string }>(path.join(mod, "package.json")).catch(() => null)
    return pkg?.version ?? version
  }

  async function finalize(provider: string | undefined, pkg: string, oldPkg: string | undefined) {
    if (provider) await track(provider, pkg)
    if (oldPkg && oldPkg !== pkg) await cleanup(provider!, oldPkg)
  }

  export async function install(pkg: string, version = "latest", provider?: string) {
    using _ = await Lock.write("bun-install")

    const mod = path.join(Global.Path.cache, "node_modules", pkg)
    const state = await readPackageJson()
    const cached = state.dependencies?.[pkg]
    const oldPkg = provider ? state.opencode?.providers?.[provider] : undefined

    // Check if we can skip installation
    const modExists = await Filesystem.exists(mod)
    if (version !== "latest") {
      if (cached === version && modExists) {
        await finalize(provider, pkg, oldPkg)
        return mod
      }
    } else {
      const outdated = await PackageRegistry.isOutdated(pkg, cached, Global.Path.cache)
      if (!outdated && modExists) {
        await finalize(provider, pkg, oldPkg)
        return mod
      }
      if (outdated) log.info("cached version is outdated", { pkg, cached })
    }

    log.info("installing package", { pkg, version })

    await BunProc.run(
      [
        "add",
        "--force",
        "--exact",
        // TODO: get rid of this case (see: https://github.com/oven-sh/bun/issues/19936)
        ...(proxied() ? ["--no-cache"] : []),
        "--cwd",
        Global.Path.cache,
        `${pkg}@${version}`,
      ],
      { cwd: Global.Path.cache },
    ).catch((e) => {
      throw new InstallFailedError({ pkg, version }, { cause: e })
    })

    // Persist resolved version and provider tracking
    const resolved = await resolveVersion(mod, version)
    const updated = await readPackageJson()
    if (!updated.dependencies) updated.dependencies = {}
    updated.dependencies[pkg] = resolved
    if (provider) {
      if (!updated.opencode) updated.opencode = {}
      if (!updated.opencode.providers) updated.opencode.providers = {}
      updated.opencode.providers[provider] = pkg
    }
    await writePackageJson(updated)

    if (oldPkg && oldPkg !== pkg) await cleanup(provider!, oldPkg)
    return mod
  }
}
