import path from "path"
import { fileURLToPath, pathToFileURL } from "url"
import { BunProc } from "@/bun"
import { Filesystem } from "@/util/filesystem"
import { isRecord } from "@/util/record"

// Old npm package names for plugins that are now built-in
export const DEPRECATED_PLUGIN_PACKAGES = ["opencode-openai-codex-auth", "opencode-copilot-auth"]

export function isDeprecatedPlugin(spec: string) {
  return DEPRECATED_PLUGIN_PACKAGES.some((pkg) => spec.includes(pkg))
}

export function parsePluginSpecifier(spec: string) {
  const lastAt = spec.lastIndexOf("@")
  const pkg = lastAt > 0 ? spec.substring(0, lastAt) : spec
  const version = lastAt > 0 ? spec.substring(lastAt + 1) : "latest"
  return { pkg, version }
}

export function isPathPluginSpec(spec: string) {
  return spec.startsWith("file://") || spec.startsWith(".") || path.isAbsolute(spec) || /^[A-Za-z]:[\\/]/.test(spec)
}

export async function resolvePathPluginTarget(spec: string) {
  const raw = spec.startsWith("file://") ? fileURLToPath(spec) : spec
  const file = path.isAbsolute(raw) || /^[A-Za-z]:[\\/]/.test(raw) ? raw : path.resolve(raw)
  const stat = await Filesystem.stat(file)
  if (!stat?.isDirectory()) {
    if (spec.startsWith("file://")) return spec
    return pathToFileURL(file).href
  }

  const pkg = await Filesystem.readJson<Record<string, unknown>>(path.join(file, "package.json")).catch(() => undefined)
  if (!pkg) throw new Error(`Plugin directory ${file} is missing package.json`)
  if (typeof pkg.main !== "string" || !pkg.main.trim()) {
    throw new Error(`Plugin directory ${file} must define package.json main`)
  }
  return pathToFileURL(path.resolve(file, pkg.main)).href
}

export async function resolvePluginTarget(spec: string, parsed = parsePluginSpecifier(spec)) {
  if (isPathPluginSpec(spec)) return resolvePathPluginTarget(spec)
  return BunProc.install(parsed.pkg, parsed.version)
}

export async function readPluginPackage(target: string) {
  const file = target.startsWith("file://") ? fileURLToPath(target) : target
  const stat = await Filesystem.stat(file)
  const dir = stat?.isDirectory() ? file : path.dirname(file)
  const pkg = path.join(dir, "package.json")
  const json = await Filesystem.readJson<Record<string, unknown>>(pkg)
  return { dir, pkg, json }
}

export function readPluginId(id: unknown, spec: string) {
  if (id === undefined) return
  if (typeof id !== "string") throw new TypeError(`Plugin ${spec} has invalid id type ${typeof id}`)
  const value = id.trim()
  if (!value) throw new TypeError(`Plugin ${spec} has an empty id`)
  return value
}

export async function resolvePluginId(spec: string, target: string, id: string | undefined) {
  if (spec.startsWith("file://")) {
    if (id) return id
    throw new TypeError(`Path plugin ${spec} must export id`)
  }
  if (id) return id
  const pkg = await readPluginPackage(target)
  if (typeof pkg.json.name !== "string" || !pkg.json.name.trim()) {
    throw new TypeError(`Plugin package ${pkg.pkg} is missing name`)
  }
  return pkg.json.name.trim()
}

export function getDefaultPlugin(mod: Record<string, unknown>) {
  // A single default object keeps v1 detection explicit and avoids scanning exports.
  const value = mod.default
  if (!isRecord(value)) return
  const server = "server" in value ? value.server : undefined
  const tui = "tui" in value ? value.tui : undefined
  if (server !== undefined && typeof server !== "function") return
  if (tui !== undefined && typeof tui !== "function") return
  if (server === undefined && tui === undefined) return
  return value
}
