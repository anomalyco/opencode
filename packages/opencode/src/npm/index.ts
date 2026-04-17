import semver from "semver"
import z from "zod"
import { NamedError } from "@opencode-ai/shared/util/error"
import { Global } from "../global"
import { Log } from "../util"
import path from "path"
import { readdir, rm } from "fs/promises"
import { Filesystem } from "@/util"
import { Flock } from "@opencode-ai/shared/util/flock"

const log = Log.create({ service: "npm" })
const illegal = process.platform === "win32" ? new Set(["<", ">", ":", '"', "|", "?", "*"]) : undefined

export const InstallFailedError = NamedError.create(
  "NpmInstallFailedError",
  z.object({
    pkg: z.string(),
  }),
)

export function sanitize(pkg: string) {
  if (!illegal) return pkg
  return Array.from(pkg, (char) => (illegal.has(char) || char.charCodeAt(0) < 32 ? "_" : char)).join("")
}

function directory(pkg: string) {
  return path.join(Global.Path.cache, "packages", sanitize(pkg))
}

function resolveEntryPoint(name: string, dir: string) {
  let entrypoint: string | undefined
  try {
    entrypoint = typeof Bun !== "undefined" ? import.meta.resolve(name, dir) : import.meta.resolve(dir)
  } catch {}
  const result = {
    directory: dir,
    entrypoint,
  }
  return result
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

  const range = /[\s^~*xX<>|=]/.test(cachedVersion)
  if (range) return !semver.satisfies(latestVersion, cachedVersion)

  return semver.lt(cachedVersion, latestVersion)
}

export async function add(pkg: string) {
  const { Arborist } = await import("@npmcli/arborist")
  const dir = directory(pkg)
  await using _ = await Flock.acquire(`npm-install:${Filesystem.resolve(dir)}`)
  log.info("installing package", {
    pkg,
  })

  const arborist = new Arborist({
    path: dir,
    binLinks: true,
    progress: false,
    savePrefix: "",
    ignoreScripts: true,
  })
  const tree = await arborist.loadVirtual().catch(() => {})
  if (tree) {
    const first = tree.edgesOut.values().next().value?.to
    if (first) {
      return resolveEntryPoint(first.name, first.path)
    }
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
  return resolveEntryPoint(first.name, first.path)
}

export async function install(dir: string) {
  await using _ = await Flock.acquire(`npm-install:${dir}`)
  log.info("checking dependencies", { dir })

  const reify = async () => {
    const { Arborist } = await import("@npmcli/arborist")
    const arb = new Arborist({
      path: dir,
      binLinks: true,
      progress: false,
      savePrefix: "",
      ignoreScripts: true,
    })
    await arb.reify().catch(() => {})
  }

  if (!(await Filesystem.exists(path.join(dir, "node_modules")))) {
    log.info("node_modules missing, reifying")
    await reify()
    return
  }

  const pkg = await Filesystem.readJson(path.join(dir, "package.json")).catch(() => ({}))
  const lock = await Filesystem.readJson(path.join(dir, "package-lock.json")).catch(() => ({}))

  const declared = new Set([
    ...Object.keys(pkg.dependencies || {}),
    ...Object.keys(pkg.devDependencies || {}),
    ...Object.keys(pkg.peerDependencies || {}),
    ...Object.keys(pkg.optionalDependencies || {}),
  ])

  const root = lock.packages?.[""] || {}
  const locked = new Set([
    ...Object.keys(root.dependencies || {}),
    ...Object.keys(root.devDependencies || {}),
    ...Object.keys(root.peerDependencies || {}),
    ...Object.keys(root.optionalDependencies || {}),
  ])

  for (const name of declared) {
    if (!locked.has(name)) {
      log.info("dependency not in lock file, reifying", { name })
      await reify()
      return
    }
  }

  log.info("dependencies in sync")
}

export async function which(pkg: string) {
  const dir = directory(pkg)
  const binDir = path.join(dir, "node_modules", ".bin")

  const pick = async () => {
    const files = await readdir(binDir).catch(() => [])
    if (files.length === 0) return undefined
    if (files.length === 1) return files[0]
    // Multiple binaries — resolve from package.json bin field like npx does
    const pkgJson = await Filesystem.readJson<{ bin?: string | Record<string, string> }>(
      path.join(dir, "node_modules", pkg, "package.json"),
    ).catch(() => undefined)
    if (pkgJson?.bin) {
      const unscoped = pkg.startsWith("@") ? pkg.split("/")[1] : pkg
      const bin = pkgJson.bin
      if (typeof bin === "string") return unscoped
      const keys = Object.keys(bin)
      if (keys.length === 1) return keys[0]
      return bin[unscoped] ? unscoped : keys[0]
    }
    return files[0]
  }

  const bin = await pick()
  if (bin) return path.join(binDir, bin)

  await rm(path.join(dir, "package-lock.json"), { force: true })
  await add(pkg)
  const resolved = await pick()
  if (!resolved) return
  return path.join(binDir, resolved)
}

export * as Npm from "."
