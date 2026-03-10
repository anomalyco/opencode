// Workaround: Bun on Windows does not support the UV_FS_O_FILEMAP flag that
// the `tar` package uses for files < 512KB (fs.open returns EINVAL).
// tar silently swallows the error and skips writing files, leaving only empty
// directories. Setting __FAKE_PLATFORM__ makes tar fall back to the plain 'w'
// flag. See tar's get-write-flag.js.
// Must be set before @npmcli/arborist is imported since tar caches the flag
// at module evaluation time — so we use a dynamic import() below.
if (process.platform === "win32") {
  process.env.__FAKE_PLATFORM__ = "linux"
}

import semver from "semver"
import z from "zod"
import { NamedError } from "@opencode-ai/util/error"
import { Global } from "../global"
import { Lock } from "../util/lock"
import { Log } from "../util/log"
import path from "path"
import { readdir } from "fs/promises"

export namespace Npm {
  const log = Log.create({ service: "npm" })

  export const InstallFailedError = NamedError.create(
    "NpmInstallFailedError",
    z.object({
      pkg: z.string(),
    }),
  )

  function directory(pkg: string) {
    return path.join(Global.Path.cache, "packages", pkg)
  }

  export async function outdated(pkg: string, cachedVersion: string): Promise<boolean> {
    const response = await fetch(`https://registry.npmjs.org/${pkg}`)
    if (!response.ok) {
      log.warn("Failed to resolve latest version, using cached", { pkg, cachedVersion })
      return false
    }

    const data = (await response.json()) as { "dist-tags"?: { latest?: string } }
    const latestVersion = data?.["dist-tags"]?.latest
    if (!latestVersion) {
      log.warn("No latest version found, using cached", { pkg, cachedVersion })
      return false
    }

    const isRange = /[\s^~*xX<>|=]/.test(cachedVersion)
    if (isRange) return !semver.satisfies(latestVersion, cachedVersion)

    return semver.lt(cachedVersion, latestVersion)
  }

  export async function add(pkg: string) {
    using _ = await Lock.write("npm-install")
    log.info("installing package using npm arborist", {
      pkg,
    })
    const hash = pkg
    const dir = directory(hash)

    const { Arborist } = await import("@npmcli/arborist")
    const arborist = new Arborist({
      path: dir,
      binLinks: true,
      progress: false,
      savePrefix: "",
    })
    const tree = await arborist.loadVirtual().catch(() => {})
    if (tree) {
      const first = tree.edgesOut.values().next().value?.to
      if (first) return first.path
    }

    const result = await arborist
      .reify({
        add: [pkg],
        save: true,
        saveType: "prod",
      })
      .catch((cause) => {
        throw new InstallFailedError(
          { pkg },
          {
            cause,
          },
        )
      })

    const first = result.edgesOut.values().next().value?.to
    if (!first) throw new InstallFailedError({ pkg })
    return first.path
  }

  export async function install(dir: string) {
    log.info("installing dependencies", { dir })
    const { Arborist } = await import("@npmcli/arborist")
    const arb = new Arborist({
      path: dir,
      binLinks: true,
      progress: false,
      savePrefix: "",
    })
    await arb.reify()
  }

  export async function which(pkg: string) {
    const dir = path.join(directory(pkg), "node_modules", ".bin")
    const files = await readdir(dir).catch(() => [])
    if (!files.length) {
      await add(pkg)
      return which(pkg)
    }
    return path.join(dir, files[0])
  }
}
