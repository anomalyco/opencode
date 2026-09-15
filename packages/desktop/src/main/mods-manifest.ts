import { isAbsolute, relative, resolve } from "node:path"

export const MOD_PERMISSIONS = [
  "storage",
  "external.open",
  "ui.sidebar",
  "ui.command",
  "ui.style",
  "ui.host",
  "server.host",
  "server.database",
] as const

export type ModPermission = (typeof MOD_PERMISSIONS)[number]

export type ModSidebarContribution = {
  id: string
  title: string
  entry: string
  order?: number
}

export type ModCommandContribution = {
  id: string
  title: string
  description?: string
  panel?: string
}

export type ModDatabaseContribution = {
  source: "production"
}

export type ModManifest = {
  id: string
  name: string
  version: string
  description?: string
  engines?: {
    opencode?: string
  }
  permissions: ModPermission[]
  entry: string
  window?: {
    width?: number
    height?: number
  }
  contributes?: {
    sidebar?: ModSidebarContribution[]
    commands?: ModCommandContribution[]
    styles?: string
    host?: string
    server?: string
    database?: ModDatabaseContribution
  }
}

export type PublicMod = Pick<ModManifest, "id" | "name" | "version" | "description" | "permissions"> & {
  priority: number
  enabled: boolean
  compatible: boolean
  error?: string
  contributes?: ModManifest["contributes"]
}

export type ModConflict = {
  modID: string
  modName: string
  type: "sidebar" | "command" | "style" | "host" | "server" | "database"
  detail: string
  certain: boolean
}

const idPattern = /^[a-z0-9][a-z0-9._-]*$/
const maxContributionCount = 256

export function parseModManifest(value: unknown): ModManifest {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Manifest must be an object")
  const manifest = value as Record<string, unknown>
  if (typeof manifest.id !== "string" || !idPattern.test(manifest.id)) {
    throw new Error("Manifest id must use lowercase letters, numbers, dots, underscores, or hyphens")
  }
  if (typeof manifest.name !== "string" || !manifest.name.trim()) throw new Error("Manifest name is required")
  if (typeof manifest.version !== "string" || !manifest.version.trim()) throw new Error("Manifest version is required")
  if (typeof manifest.entry !== "string" || !manifest.entry.trim()) throw new Error("Manifest entry is required")
  if (manifest.description !== undefined && typeof manifest.description !== "string") {
    throw new Error("Manifest description must be a string")
  }
  if (
    manifest.engines !== undefined &&
    (!manifest.engines ||
      typeof manifest.engines !== "object" ||
      Array.isArray(manifest.engines) ||
      ((manifest.engines as Record<string, unknown>).opencode !== undefined &&
        typeof (manifest.engines as Record<string, unknown>).opencode !== "string"))
  ) {
    throw new Error("Manifest engines.opencode must be a string")
  }
  if (
    manifest.permissions !== undefined &&
    (!Array.isArray(manifest.permissions) ||
      manifest.permissions.some(
        (permission) => typeof permission !== "string" || !MOD_PERMISSIONS.includes(permission as ModPermission),
      ))
  ) {
    throw new Error(`Manifest permissions must be one of: ${MOD_PERMISSIONS.join(", ")}`)
  }
  if (
    manifest.window !== undefined &&
    (!manifest.window ||
      typeof manifest.window !== "object" ||
      Array.isArray(manifest.window) ||
      Object.values(manifest.window as Record<string, unknown>).some(
        (value) =>
          value !== undefined && (!Number.isInteger(value) || (value as number) < 320 || (value as number) > 2400),
      ))
  ) {
    throw new Error("Manifest window dimensions must be integers between 320 and 2400")
  }
  if (
    manifest.contributes !== undefined &&
    (!manifest.contributes || typeof manifest.contributes !== "object" || Array.isArray(manifest.contributes))
  ) {
    throw new Error("Manifest contributes must be an object")
  }
  const contributes = manifest.contributes as Record<string, unknown> | undefined
  if (
    contributes?.sidebar !== undefined &&
    (!Array.isArray(contributes.sidebar) ||
      contributes.sidebar.length > maxContributionCount ||
      contributes.sidebar.some((item) => !isSidebarContribution(item)))
  ) {
    throw new Error("Manifest sidebar contributions must have safe ids, titles, entries, optional numeric order, and at most 256 items")
  }
  if (
    contributes?.commands !== undefined &&
    (!Array.isArray(contributes.commands) ||
      contributes.commands.length > maxContributionCount ||
      contributes.commands.some((item) => !isCommandContribution(item)))
  ) {
    throw new Error("Manifest command contributions must have safe ids, titles, and at most 256 items")
  }
  if (contributes?.styles !== undefined && (typeof contributes.styles !== "string" || !contributes.styles.trim())) {
    throw new Error("Manifest styles contribution must be a path")
  }
  if (contributes?.host !== undefined && (typeof contributes.host !== "string" || !contributes.host.trim())) {
    throw new Error("Manifest host contribution must be a path")
  }
  if (contributes?.server !== undefined && (typeof contributes.server !== "string" || !contributes.server.trim())) {
    throw new Error("Manifest server contribution must be a path")
  }
  if (
    contributes?.database !== undefined &&
    (!contributes.database ||
      typeof contributes.database !== "object" ||
      Array.isArray(contributes.database) ||
      (contributes.database as Record<string, unknown>).source !== "production")
  ) {
    throw new Error('Manifest database contribution must use source "production"')
  }
  const permissions = [...new Set((manifest.permissions ?? []) as ModPermission[])]
  if (contributes?.sidebar?.length && !permissions.includes("ui.sidebar")) {
    throw new Error("Sidebar contributions require ui.sidebar permission")
  }
  if (contributes?.commands?.length && !permissions.includes("ui.command")) {
    throw new Error("Command contributions require ui.command permission")
  }
  if (contributes?.styles && !permissions.includes("ui.style")) {
    throw new Error("Styles contribution requires ui.style permission")
  }
  if (contributes?.host && !permissions.includes("ui.host")) {
    throw new Error("Host contributions require ui.host permission")
  }
  if (contributes?.server && !permissions.includes("server.host")) {
    throw new Error("Server contributions require server.host permission")
  }
  if (contributes?.database && !permissions.includes("server.database")) {
    throw new Error("Database contributions require server.database permission")
  }
  const sidebar = (contributes?.sidebar as Array<Record<string, unknown>> | undefined)?.map((item) => ({
    id: item.id as string,
    title: (item.title as string).trim(),
    entry: item.entry as string,
    order: item.order as number | undefined,
  }))
  const commands = (contributes?.commands as Array<Record<string, unknown>> | undefined)?.map((item) => ({
    id: item.id as string,
    title: (item.title as string).trim(),
    description: item.description as string | undefined,
    panel: item.panel as string | undefined,
  }))
  if (sidebar && new Set(sidebar.map((item) => item.id)).size !== sidebar.length) {
    throw new Error("Sidebar contribution ids must be unique")
  }
  if (commands && new Set(commands.map((item) => item.id)).size !== commands.length) {
    throw new Error("Command contribution ids must be unique")
  }
  if (commands?.some((command) => command.panel && !sidebar?.some((panel) => panel.id === command.panel))) {
    throw new Error("Command contribution panel must reference a sidebar contribution")
  }

  return {
    id: manifest.id,
    name: manifest.name.trim(),
    version: manifest.version.trim(),
    description: manifest.description,
    engines: manifest.engines as ModManifest["engines"],
    permissions,
    entry: manifest.entry,
    window: manifest.window as ModManifest["window"],
    contributes: {
      sidebar,
      commands,
      styles: contributes?.styles as string | undefined,
      host: contributes?.host as string | undefined,
      server: contributes?.server as string | undefined,
      database: contributes?.database as ModDatabaseContribution | undefined,
    },
  }
}

export function resolveModPath(root: string, input: string) {
  const file = resolve(root, `.${input.startsWith("/") ? input : `/${input}`}`)
  const path = relative(root, file)
  if (path.startsWith("..") || isAbsolute(path)) throw new Error("Path must stay inside the MOD directory")
  return file
}

export function isModCompatible(range: string | undefined, version: string) {
  if (!range || range === "*") return true
  if (range === version) return true
  const current = version.split(".").map(Number)
  const requested = range.match(/^([~^])(\d+)\.(\d+)(?:\.(\d+))?$/)
  if (!requested || current.some(Number.isNaN)) return false
  const [, operator, major, minor, patch = "0"] = requested
  const target = [Number(major), Number(minor), Number(patch)]
  if (operator === "^") return current[0] === target[0] && compareVersions(current, target) >= 0
  return current[0] === target[0] && current[1] === target[1] && compareVersions(current, target) >= 0
}

export function findModConflicts(candidate: ModManifest, existing: ModManifest): ModConflict[] {
  const conflict = (type: ModConflict["type"], detail: string, certain: boolean): ModConflict => ({
    modID: existing.id,
    modName: existing.name,
    type,
    detail,
    certain,
  })
  const sidebarIDs = new Set(existing.contributes?.sidebar?.map((item) => item.id))
  const commandIDs = new Set(existing.contributes?.commands?.map((item) => item.id))
  const sidebar = candidate.contributes?.sidebar
    ?.flatMap((item) =>
      sidebarIDs.has(item.id)
        ? [conflict("sidebar", `Both MODs contribute the "${item.id}" sidebar panel.`, true)]
        : [],
    )
  const commands = candidate.contributes?.commands
    ?.flatMap((item) =>
      commandIDs.has(item.id)
        ? [conflict("command", `Both MODs contribute the "${item.id}" command.`, true)]
        : [],
    )
  const styles =
    candidate.contributes?.styles && existing.contributes?.styles
      ? [conflict("style", "Both MODs inject renderer styles; CSS rules can override each other.", false)]
      : []
  const host =
    candidate.contributes?.host && existing.contributes?.host
      ? [conflict("host", "Both MODs run trusted host scripts that can modify the same UI.", false)]
      : []
  const server =
    candidate.contributes?.server && existing.contributes?.server
      ? [conflict("server", "Both MODs run trusted server plugins; their hooks can overlap.", false)]
      : []
  const database =
    candidate.contributes?.database && existing.contributes?.database
      ? [conflict("database", "Both MODs select a shared session database.", true)]
      : []
  return [...(sidebar ?? []), ...(commands ?? []), ...styles, ...host, ...server, ...database]
}

function compareVersions(left: number[], right: number[]) {
  for (const index of [0, 1, 2]) {
    if (left[index] !== right[index]) return left[index] - right[index]
  }
  return 0
}

function isContributionID(value: unknown): value is string {
  return typeof value === "string" && idPattern.test(value)
}

function isSidebarContribution(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false
  const item = value as Record<string, unknown>
  return (
    isContributionID(item.id) &&
    typeof item.title === "string" &&
    Boolean(item.title.trim()) &&
    typeof item.entry === "string" &&
    Boolean(item.entry.trim()) &&
    (item.order === undefined || Number.isFinite(item.order))
  )
}

function isCommandContribution(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false
  const item = value as Record<string, unknown>
  return (
    isContributionID(item.id) &&
    typeof item.title === "string" &&
    Boolean(item.title.trim()) &&
    (item.description === undefined || typeof item.description === "string") &&
    (item.panel === undefined || isContributionID(item.panel))
  )
}
