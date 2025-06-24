import { z } from "zod"
import { Global } from "../global"
import { Log } from "../util/log"
import path from "path"
import { NamedError } from "../util/error"

export namespace BunProc {
  const log = Log.create({ service: "bun" })

  export async function run(
    cmd: string[],
    options?: Bun.SpawnOptions.OptionsObject<any, any, any>,
  ) {
    log.info("running", {
      cmd: [which(), ...cmd],
      options,
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
    const mod = path.join(Global.Path.cache, "node_modules", pkg)
    const pkgjson = Bun.file(path.join(Global.Path.cache, "package.json"))
    const parsed = await pkgjson.json().catch(() => ({
      dependencies: {},
    }))
    if (parsed.dependencies[pkg] === version) return mod
    parsed.dependencies[pkg] = version
    await Bun.write(pkgjson, JSON.stringify(parsed, null, 2))
    await BunProc.run(
      ["install", "--registry", "https://registry.npmjs.org/"],
      {
        cwd: Global.Path.cache,
      },
    ).catch((e) => {
      new InstallFailedError(
        { pkg, version },
        {
          cause: e,
        },
      )
    })
    return mod
  }
}
