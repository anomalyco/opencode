import semver from "semver"
import z from "zod"
import { NamedError } from "@opencode-ai/shared/util/error"
import { Global } from "../global"
import { Log } from "../util/log"
import path from "path"
import { readdir, rm } from "fs/promises"
import { Filesystem } from "@/util/filesystem"
import { Flock } from "@opencode-ai/shared/util/flock"
import { Arborist } from "@npmcli/arborist"
import { load as loadConfig } from "./config"
import { preResolveGitSubdir } from "./git"
import { classify } from "./spec"
import { preResolveReleaseAsset } from "./release"

export namespace Npm {
  const log = Log.create({ service: "npm" })
  // Always sanitize `:` (URL-scheme delimiter) and control chars regardless of platform:
  // bun's import resolver treats `foo:/bar` paths as URL schemes and bypasses registered
  // plugins (like @opentui/solid's JSX transform), even when the path exists on disk.
  // The Windows-only reserved set additionally includes <, >, ", |, ?, *.
  const illegal =
    process.platform === "win32"
      ? new Set(["<", ">", ":", '"', "|", "?", "*"])
      : new Set([":"])

  async function meta(pkg: string) {
    const response = await fetch(`https://registry.npmjs.org/${pkg}`).catch(() => undefined)
    if (!response?.ok) return
    return (await response.json()) as { "dist-tags"?: Record<string, string> }
  }

  async function tag(pkg: string, name = "latest") {
    const data = await meta(pkg)
    const value = data?.["dist-tags"]?.[name]
    if (value) return value
    log.warn("No dist-tag found, using cached", { pkg, name })
  }

  export const InstallFailedError = NamedError.create(
    "NpmInstallFailedError",
    z.object({
      pkg: z.string(),
    }),
  )

  export function sanitize(pkg: string) {
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

  /**
   * Check if a registry-installed package has an updated dist-tag.
   *
   * KNOWN GAP: This only consults the default npm registry (registry.npmjs.org).
   * For packages installed from GitHub Packages or other scoped registries,
   * this check is silently wrong — it will never detect a moved dist-tag.
   * Registry-aware dist-tag lookup is tracked as a follow-up.
   */
  export async function outdated(pkg: string, cachedVersion: string, name = "latest"): Promise<boolean> {
    const latestVersion = await tag(pkg, name)
    if (!latestVersion) {
      log.warn("No latest version found, using cached", { pkg, cachedVersion })
      return false
    }

    const exact = semver.valid(cachedVersion)
    const range = semver.validRange(cachedVersion)
    if (!exact && !range) return false
    if (range && !exact) return !semver.satisfies(latestVersion, range)

    return semver.lt(cachedVersion, latestVersion)
  }

  /**
   * Install a plugin-style package and return its directory + entrypoint.
   *
   * Accepted spec shapes:
   * - npm registry:       `@scope/pkg@1.2.3`, `pkg@latest`, `pkg@^1`
   * - GitHub Packages:    same shape, routed via user's ~/.npmrc scope config
   * - GitHub shorthand:   `github:owner/repo#ref` (private: relies on git credential helper)
   * - GitHub + subdir:    `github:owner/repo#main::path:packages/foo`
   * - Git+HTTPS URL:      `git+https://github.com/owner/repo.git#ref`
   * - Release asset URL:  `https://github.com/owner/repo/releases/download/tag/file.tgz`
   *                       (auth via GITHUB_TOKEN/GH_TOKEN env, or `gh auth token` fallback)
   * - Local path:         `file:./rel`, `/abs/path`, `./rel`, `~/rel` (resolved from cwd)
   */
  export async function add(pkg: string) {
    const spec = classify(pkg)
    const cfg = await loadConfig()
    let forArborist: string
    if (spec.kind === "release") {
      const local = await preResolveReleaseAsset(spec, { cacheRoot: Global.Path.cache })
      forArborist = `file:${local}`
    } else if ((spec.kind === "git" || spec.kind === "github") && pkg.includes("::path:")) {
      const local = await preResolveGitSubdir(pkg, Global.Path.cache, cfg)
      forArborist = `file:${local}`
    } else if (spec.kind === "file") {
      forArborist = `file:${spec.path}`
    } else {
      forArborist = pkg
    }

    const dir = directory(pkg)
    await using _ = await Flock.acquire(`npm-install:${Filesystem.resolve(dir)}`)
    log.info("installing package", { pkg, forArborist })

    const arborist = new Arborist({
      ...cfg,
      path: dir,
      binLinks: true,
      progress: false,
      savePrefix: "",
      ignoreScripts: true,
      // Skip auto-installing peerDependencies into the plugin cache. Plugins import shared
      // runtimes (e.g. @opentui/solid, solid-js) that are already bundled into opencode's
      // binary and re-exported via @opentui/solid/runtime-plugin-support. Installing a
      // second copy here creates two module identities, causing context/signal mismatch.
      legacyPeerDeps: true,
    })

    const tree = await arborist.loadVirtual().catch(() => {})
    if (tree) {
      const first = tree.edgesOut.values().next().value?.to
      if (first) {
        if (spec.kind === "registry") {
          if (spec.version === "latest" || !semver.validRange(spec.version)) {
            const version = await Filesystem.readJson<{ version?: string }>(path.join(first.path, "package.json"))
              .then((x) => x.version)
              .catch(() => undefined)
            const next = await tag(spec.name, spec.version)
            if (version && next && version !== next) {
              log.info("dist-tag moved, reinstalling package", { pkg, version, next })
            } else {
              return resolveEntryPoint(first.name, first.path)
            }
          } else {
            return resolveEntryPoint(first.name, first.path)
          }
        } else {
          // Non-registry specs: cache hit returns the installed tree. No dist-tag check.
          return resolveEntryPoint(first.name, first.path)
        }
      }
    }

    const result = await arborist
      .reify({
        add: [forArborist],
        save: true,
        saveType: "prod",
      })
      .catch((cause: unknown) => {
        throw new InstallFailedError({ pkg }, { cause })
      })

    const first = result.edgesOut.values().next().value?.to
    if (!first) throw new InstallFailedError({ pkg })
    return resolveEntryPoint(first.name, first.path)
  }

  export async function install(dir: string) {
    await using _ = await Flock.acquire(`npm-install:${dir}`)
    log.info("checking dependencies", { dir })

    const reify = async () => {
      // NOTE: We intentionally do NOT pass @npmcli/config flat options here.
      // Npm.install bootstraps @opencode-ai/plugin in .opencode dirs. The repo uses
      // bun workspace linking to resolve it to the in-repo source during development.
      // Passing `...cfg` (which sets registry/cache) forces Arborist to resolve against
      // the public npm registry instead, pulling v1.4.x which lacks APIs the current
      // dev code expects. Keep Arborist in its default (workspace-aware) mode here.
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
}
