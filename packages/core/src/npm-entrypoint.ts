export * as NpmEntrypoint from "./npm-entrypoint"

import path from "path"
import { existsSync, readFileSync } from "fs"
import { createRequire } from "module"
import { pathToFileURL } from "url"
import { Option } from "effect"

export interface EntryPoint {
  readonly directory: string
  readonly entrypoint: Option.Option<string>
}

// This resolver feeds dynamic import(), so "require" is intentionally not a supported condition.
const supportedExportConditions = new Set([
  ...(process.execArgv.includes("--no-addons") ? [] : ["node-addons"]),
  "node",
  "import",
  ...(typeof Bun === "undefined" ? ["module-sync"] : ["bun"]),
])

export function resolve(name: string, dir: string): EntryPoint {
  return {
    directory: dir,
    entrypoint: tryResolvePackageEntryPoint(name, dir),
  }
}

export function resolveManual(name: string, dir: string): EntryPoint {
  return {
    directory: dir,
    entrypoint: tryResolveManualPackageEntryPoint(name, dir),
  }
}

function tryResolvePackageEntryPoint(name: string, dir: string) {
  if (typeof Bun !== "undefined") {
    try {
      return Option.some(import.meta.resolve(name, dir))
    } catch {}
  }

  return tryResolveManualPackageEntryPoint(name, dir)
}

function tryResolveManualPackageEntryPoint(name: string, dir: string) {
  try {
    return Option.some(resolvePackageEntryPoint(name, dir))
  } catch {
    return Option.none()
  }
}

function resolvePackageEntryPoint(name: string, dir: string): string {
  const pkg = JSON.parse(readFileSync(path.join(dir, "package.json"), "utf8")) as {
    exports?: unknown
    main?: unknown
    module?: unknown
  }
  const target =
    pkg.exports === undefined
      ? resolveLegacyEntryPoint(name, dir, pkg)
      : resolvePackageExport(pkg.exports, dir)
  if (!target) throw new Error(`Package ${name} has no import entrypoint`)
  return pathToFileURL(target).href
}

function resolveLegacyEntryPoint(name: string, dir: string, pkg: { main?: unknown; module?: unknown }): string {
  try {
    return createRequire(path.join(dir, "package.json")).resolve(name)
  } catch {}

  return resolveFile(
    dir,
    typeof pkg.module === "string" ? pkg.module : typeof pkg.main === "string" ? pkg.main : "index.js",
  )
}

function resolvePackageExport(input: unknown, dir: string): string | undefined {
  if (typeof input === "string") return resolvePackageTarget(dir, input)
  if (Array.isArray(input)) {
    return firstResolved(input, (item) => resolvePackageExport(item, dir))
  }
  if (typeof input !== "object" || input === null || Array.isArray(input)) return undefined

  const record = input as Record<string, unknown>
  const keys = Object.keys(record)
  const hasSubpath = keys.some((key) => key.startsWith("."))
  const hasCondition = keys.some((key) => !key.startsWith("."))
  if (hasSubpath && hasCondition) return undefined
  if (hasSubpath) return "." in record ? resolvePackageExport(record["."], dir) : undefined
  return resolveConditionalExport(record, dir)
}

function resolveConditionalExport(input: Record<string, unknown>, dir: string): string | undefined {
  return firstResolved(Object.keys(input), (key) =>
    key === "default" || supportedExportConditions.has(key) ? resolvePackageExport(input[key], dir) : undefined,
  )
}

function firstResolved<T>(input: Iterable<T>, resolve: (item: T) => string | undefined): string | undefined {
  for (const item of input) {
    const resolved = resolve(item)
    if (resolved !== undefined) return resolved
  }
  return undefined
}

function resolvePackageTarget(dir: string, target: string): string | undefined {
  if (!target.startsWith("./")) return undefined
  if (
    target
      .slice(2)
      .split(/[\\/]/)
      .some(isInvalidPackageTargetSegment)
  )
    return undefined
  const resolved = path.resolve(dir, target.replace(/\\/g, "/"))
  const relative = path.relative(dir, resolved)
  if (relative === "" || relative.startsWith("..") || path.isAbsolute(relative)) return undefined
  return resolved
}

function isInvalidPackageTargetSegment(segment: string) {
  if (segment === "") return true
  let decoded: string
  try {
    decoded = decodeURIComponent(segment)
  } catch {
    return true
  }
  return (
    decoded === "." ||
    decoded === ".." ||
    decoded.toLowerCase() === "node_modules" ||
    decoded.includes("/") ||
    decoded.includes("\\")
  )
}

function resolveFile(dir: string, target: string): string {
  const full = path.resolve(dir, target)
  return (
    [full, `${full}.js`, `${full}.mjs`, `${full}.cjs`, path.join(full, "index.js"), path.join(full, "index.mjs")].find(
      existsSync,
    ) ?? full
  )
}
