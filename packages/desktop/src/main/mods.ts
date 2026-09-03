import { mkdir, readdir, realpath, readFile, stat } from "node:fs/promises"
import { dirname, isAbsolute, join, relative } from "node:path"
import { app, BrowserWindow, net, protocol, shell } from "electron"
import { fileURLToPath, pathToFileURL } from "node:url"
import { ENABLED_MODS_KEY, MOD_PRIORITIES_KEY, MODS_SAFE_MODE_KEY } from "./store-keys"
import { getStore } from "./store"
import {
  findModConflicts,
  isModCompatible,
  parseModManifest,
  resolveModPath,
  type ModConflict,
  type ModManifest,
  type PublicMod,
} from "./mods-manifest"

const root = dirname(fileURLToPath(import.meta.url))
const protocolName = "oc-mod"

protocol.registerSchemesAsPrivileged([
  {
    scheme: protocolName,
    privileges: {
      secure: true,
      standard: true,
      supportFetchAPI: true,
      stream: true,
    },
  },
])

type InstalledMod = {
  manifest: ModManifest
  root: string
  realRoot: string
}

type ConflictIndex = {
  sidebar: Map<string, Set<string>>
  command: Map<string, Set<string>>
  style: Set<string>
  host: Set<string>
  server: Set<string>
  database: Set<string>
}

const maxManifestBytes = 1024 * 1024
const reloadBatchSize = 16
export const MOD_LOADER_VERSION = "0.1.1"

export function createModManager(version: string) {
  const installed = new Map<string, InstalledMod>()
  const failures = new Map<string, string>()
  const windows = new Map<number, string>()
  const conflictIndex: ConflictIndex = {
    sidebar: new Map(),
    command: new Map(),
    style: new Set(),
    host: new Set(),
    server: new Set(),
    database: new Set(),
  }

  function enabledIDs() {
    const value = getStore().get(ENABLED_MODS_KEY)
    return Array.isArray(value) ? value.filter((id): id is string => typeof id === "string") : []
  }

  function priorityFor(id: string) {
    const value = getStore().get(MOD_PRIORITIES_KEY)
    if (!value || typeof value !== "object" || Array.isArray(value)) return 0
    const priority = (value as Record<string, unknown>)[id]
    return typeof priority === "number" && Number.isSafeInteger(priority) ? priority : 0
  }

  function safeMode() {
    return getStore().get(MODS_SAFE_MODE_KEY) === true
  }

  function status() {
    return { version: MOD_LOADER_VERSION, enabled: !safeMode() }
  }

  function isEnabled(id: string) {
    return !safeMode() && enabledIDs().includes(id)
  }

  function setEnabled(id: string, enabled: boolean, resolution?: "candidate" | "existing") {
    const mod = installed.get(id)
    if (!mod) throw new Error(`MOD "${id}" was not found`)
    if (!isModCompatible(mod.manifest.engines?.opencode, version)) throw new Error(`MOD "${id}" is not compatible`)
    const conflicts = conflictsFor(id)
    if (enabled && conflicts.length && !resolution) {
      throw new Error(`MOD "${id}" conflicts with enabled MODs. Choose a load priority before enabling it.`)
    }
    if (enabled && conflicts.length && resolution) {
      const priorities = conflicts.map((conflict) => priorityFor(conflict.modID))
      const priority =
        resolution === "candidate"
          ? Math.max(...priorities) < 1000
            ? Math.max(...priorities) + 1
            : 1000
          : Math.min(...priorities) > -1000
            ? Math.min(...priorities) - 1
            : -1000
      if (priority === 1000) conflicts.forEach((conflict) => setPriority(conflict.modID, 999))
      if (priority === -1000) conflicts.forEach((conflict) => setPriority(conflict.modID, -999))
      setPriority(id, priority)
    }
    const ids = enabledIDs().filter((item) => item !== id)
    getStore().set(ENABLED_MODS_KEY, enabled ? [...ids, id] : ids)
    rebuildConflictIndex()
    if (!enabled) {
      for (const [webContentsID, modID] of windows) {
        if (modID !== id) continue
        BrowserWindow.getAllWindows()
          .find((win) => win.webContents.id === webContentsID)
          ?.close()
      }
    }
  }

  function setPriority(id: string, priority: number) {
    if (!installed.has(id)) throw new Error(`MOD "${id}" was not found`)
    if (!Number.isSafeInteger(priority) || priority < -1000 || priority > 1000) {
      throw new Error("MOD priority must be an integer between -1000 and 1000")
    }
    const value = getStore().get(MOD_PRIORITIES_KEY)
    const priorities =
      value && typeof value === "object" && !Array.isArray(value)
        ? Object.fromEntries(
            Object.entries(value).filter(
              (entry): entry is [string, number] => typeof entry[1] === "number" && Number.isSafeInteger(entry[1]),
            ),
          )
        : {}
    if (priority === 0) delete priorities[id]
    else priorities[id] = priority
    getStore().set(MOD_PRIORITIES_KEY, priorities)
  }

  function setSafeMode(enabled: boolean) {
    getStore().set(MODS_SAFE_MODE_KEY, enabled)
    rebuildConflictIndex()
    if (!enabled) return
    BrowserWindow.getAllWindows()
      .filter((win) => windows.has(win.webContents.id))
      .forEach((win) => win.close())
  }

  async function reload() {
    const directory = modsDirectory()
    await mkdir(directory, { recursive: true })
    const entries = await readdir(directory, { withFileTypes: true }).catch(() => [])
    const nextInstalled = new Map<string, InstalledMod>()
    const nextFailures = new Map<string, string>()
    const directories = entries.filter((entry) => entry.isDirectory())
    for (const batch of Array.from({ length: Math.ceil(directories.length / reloadBatchSize) }, (_, index) =>
      directories.slice(index * reloadBatchSize, (index + 1) * reloadBatchSize),
    )) {
      await Promise.all(
        batch.map(async (entry) => {
          const modRoot = join(directory, entry.name)
          try {
            const mod = await loadMod(modRoot, entry.name)
            nextInstalled.set(mod.manifest.id, mod)
          } catch (error) {
            nextFailures.set(entry.name, error instanceof Error ? error.message : "Unable to read MOD manifest")
          }
        }),
      )
    }
    installed.clear()
    nextInstalled.forEach((mod, id) => installed.set(id, mod))
    failures.clear()
    nextFailures.forEach((error, id) => failures.set(id, error))
    rebuildConflictIndex()
  }

  function conflictsFor(id: string): ModConflict[] {
    const candidate = installed.get(id)
    if (!candidate) throw new Error(`MOD "${id}" was not found`)
    const ids = new Set<string>([
      ...(candidate.manifest.contributes?.sidebar?.flatMap((panel) => [...(conflictIndex.sidebar.get(panel.id) ?? [])]) ??
        []),
      ...(candidate.manifest.contributes?.commands?.flatMap((command) => [
        ...(conflictIndex.command.get(command.id) ?? []),
      ]) ?? []),
      ...(candidate.manifest.contributes?.styles ? conflictIndex.style : []),
      ...(candidate.manifest.contributes?.host ? conflictIndex.host : []),
      ...(candidate.manifest.contributes?.server ? conflictIndex.server : []),
      ...(candidate.manifest.contributes?.database ? conflictIndex.database : []),
    ])
    ids.delete(id)
    return [...ids]
      .map((existingID) => installed.get(existingID))
      .filter((existing): existing is InstalledMod => Boolean(existing))
      .flatMap((existing) => findModConflicts(candidate.manifest, existing.manifest))
  }

  async function preload(id: string) {
    const previous = installed.get(id)
    if (!previous) throw new Error(`MOD "${id}" was not found. Refresh the MOD list and try again.`)
    const mod = await loadMod(previous.root, id)
    installed.set(id, mod)
    failures.delete(id)
    rebuildConflictIndex()
    if (!isModCompatible(mod.manifest.engines?.opencode, version)) throw new Error(`MOD "${id}" is not compatible`)
    return {
      mod: publicMod(mod),
      conflicts: conflictsFor(id),
      directory: mod.root,
    }
  }

  function rebuildConflictIndex() {
    conflictIndex.sidebar.clear()
    conflictIndex.command.clear()
    conflictIndex.style.clear()
    conflictIndex.host.clear()
    conflictIndex.server.clear()
    conflictIndex.database.clear()
    if (safeMode()) return
    const enabled = new Set(enabledIDs())
    installed.forEach((mod) => {
      if (!enabled.has(mod.manifest.id) || !isModCompatible(mod.manifest.engines?.opencode, version)) return
      mod.manifest.contributes?.sidebar?.forEach((panel) => addIndex(conflictIndex.sidebar, panel.id, mod.manifest.id))
      mod.manifest.contributes?.commands?.forEach((command) => addIndex(conflictIndex.command, command.id, mod.manifest.id))
      if (mod.manifest.contributes?.styles) conflictIndex.style.add(mod.manifest.id)
      if (mod.manifest.contributes?.host) conflictIndex.host.add(mod.manifest.id)
      if (mod.manifest.contributes?.server) conflictIndex.server.add(mod.manifest.id)
      if (mod.manifest.contributes?.database) conflictIndex.database.add(mod.manifest.id)
    })
  }

  function list(): PublicMod[] {
    return [
      ...[...installed.values()].map(publicMod),
      ...[...failures].map(([id, error]) => ({
        id,
        name: id,
        version: "Invalid",
        permissions: [],
        priority: 0,
        enabled: false,
        compatible: false,
        error,
      })),
    ].sort(
      (left, right) =>
        left.priority - right.priority || left.name.localeCompare(right.name) || left.id.localeCompare(right.id),
    )
  }

  function publicMod(mod: InstalledMod): PublicMod {
    return {
      id: mod.manifest.id,
      name: mod.manifest.name,
      version: mod.manifest.version,
      description: mod.manifest.description,
      permissions: mod.manifest.permissions,
      priority: priorityFor(mod.manifest.id),
      enabled: isEnabled(mod.manifest.id),
      compatible: isModCompatible(mod.manifest.engines?.opencode, version),
      contributes: mod.manifest.contributes,
    }
  }

  function serverEntries() {
    return [...installed.values()]
      .filter(
        (mod) =>
          isEnabled(mod.manifest.id) &&
          isModCompatible(mod.manifest.engines?.opencode, version) &&
          mod.manifest.permissions.includes("server.host") &&
          mod.manifest.contributes?.server,
      )
      .sort(
        (left, right) =>
          priorityFor(left.manifest.id) - priorityFor(right.manifest.id) ||
          left.manifest.name.localeCompare(right.manifest.name) ||
          left.manifest.id.localeCompare(right.manifest.id),
      )
      .map((mod) => resolveModPath(mod.root, mod.manifest.contributes!.server!))
  }

  function shareProductionDatabase() {
    return [...installed.values()].some(
      (mod) =>
        isEnabled(mod.manifest.id) &&
        isModCompatible(mod.manifest.engines?.opencode, version) &&
        mod.manifest.permissions.includes("server.database") &&
        mod.manifest.contributes?.database?.source === "production",
    )
  }

  async function openWindow(id: string) {
    const mod = installed.get(id)
    if (!mod) throw new Error(`MOD "${id}" was not found`)
    if (!isEnabled(id)) throw new Error(`MOD "${id}" is disabled`)
    if (!isModCompatible(mod.manifest.engines?.opencode, version)) throw new Error(`MOD "${id}" is not compatible`)

    const existing = [...windows.entries()].find(([, modID]) => modID === id)
    if (existing) {
      const win = BrowserWindow.getAllWindows().find((item) => item.webContents.id === existing[0])
      if (win) {
        win.show()
        win.focus()
        return
      }
    }

    const win = new BrowserWindow({
      width: mod.manifest.window?.width ?? 960,
      height: mod.manifest.window?.height ?? 720,
      minWidth: 320,
      minHeight: 320,
      title: `${mod.manifest.name} - OpenCode MOD`,
      autoHideMenuBar: true,
      webPreferences: {
        preload: join(root, "../preload/mod.js"),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        additionalArguments: [`--opencode-mod=${id}`],
      },
    })
    windows.set(win.webContents.id, id)
    win.once("closed", () => windows.delete(win.webContents.id))
    win.webContents.setWindowOpenHandler(({ url }) => {
      if (hasPermission(win.webContents.id, "external.open") && isHttpUrl(url)) void shell.openExternal(url)
      return { action: "deny" }
    })
    win.webContents.on("will-navigate", (event, url) => {
      if (url.startsWith(`${protocolName}://${id}/`)) return
      event.preventDefault()
      if (hasPermission(win.webContents.id, "external.open") && isHttpUrl(url)) void shell.openExternal(url)
    })
    await win.loadURL(`${protocolName}://${id}/${encodeURI(mod.manifest.entry.replace(/^[/\\]+/, ""))}`)
  }

  function manifestFor(webContentsID: number) {
    const id = windows.get(webContentsID)
    const mod = id ? installed.get(id) : undefined
    if (!id || !mod || !isEnabled(id)) throw new Error("Unauthorized MOD window")
    return { id, mod }
  }

  function manifestForID(id: string) {
    const mod = installed.get(id)
    if (!mod || !isEnabled(id) || !isModCompatible(mod.manifest.engines?.opencode, version)) {
      throw new Error("Unauthorized MOD")
    }
    return mod
  }

  function hasPermission(webContentsID: number, permission: ModManifest["permissions"][number]) {
    try {
      return manifestFor(webContentsID).mod.manifest.permissions.includes(permission)
    } catch {
      return false
    }
  }

  function hasPermissionForID(id: string, permission: ModManifest["permissions"][number]) {
    try {
      return manifestForID(id).manifest.permissions.includes(permission)
    } catch {
      return false
    }
  }

  async function fetch(request: Request) {
    const url = new URL(request.url)
    const mod = installed.get(url.hostname)
    if (!mod || !isEnabled(url.hostname)) return new Response("Not found", { status: 404 })
    try {
      const file = resolveModPath(mod.root, decodeURIComponent(url.pathname))
      const realFile = await realpath(file)
      const path = relative(mod.realRoot, realFile)
      if (path.startsWith("..") || isAbsolute(path)) return new Response("Not found", { status: 404 })
      const response = await net.fetch(pathToFileURL(realFile).toString(), {
        headers: request.headers.get("range") ? { range: request.headers.get("range")! } : undefined,
      })
      const headers = new Headers(response.headers)
      headers.set(
        "Content-Security-Policy",
        "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'self'; media-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors oc://renderer; form-action 'none'",
      )
      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers,
      })
    } catch {
      return new Response("Not found", { status: 404 })
    }
  }

  return {
    reload,
    list,
    serverEntries,
    shareProductionDatabase,
    safeMode,
    status,
    setSafeMode,
    setEnabled,
    setPriority,
    preload,
    openWindow,
    openFolder: () => shell.openPath(modsDirectory()),
    manifestFor,
    manifestForID,
    hasPermission,
    hasPermissionForID,
    fetch,
  }
}

async function loadMod(modRoot: string, id: string): Promise<InstalledMod> {
  const manifestPath = join(modRoot, "mod.json")
  const manifestStat = await stat(manifestPath)
  if (!manifestStat.isFile()) throw new Error("mod.json must be a file")
  if (manifestStat.size > maxManifestBytes) throw new Error("mod.json must not exceed 1 MB")
  const manifest = parseModManifest(JSON.parse(await readFile(manifestPath, "utf8")))
  if (manifest.id !== id) throw new Error("Folder name must match manifest id")
  resolveModPath(modRoot, manifest.entry)
  manifest.contributes?.sidebar?.forEach((panel) => resolveModPath(modRoot, panel.entry))
  if (manifest.contributes?.styles) resolveModPath(modRoot, manifest.contributes.styles)
  if (manifest.contributes?.host) resolveModPath(modRoot, manifest.contributes.host)
  if (manifest.contributes?.server) resolveModPath(modRoot, manifest.contributes.server)
  return { manifest, root: modRoot, realRoot: await realpath(modRoot) }
}

function addIndex(index: Map<string, Set<string>>, key: string, id: string) {
  const ids = index.get(key) ?? new Set<string>()
  ids.add(id)
  index.set(key, ids)
}

export function registerModProtocol(manager: ReturnType<typeof createModManager>) {
  if (protocol.isProtocolHandled(protocolName)) return
  protocol.handle(protocolName, (request) => manager.fetch(request))
}

export function modsDirectory() {
  return join(app.getPath("userData"), "mods")
}

function isHttpUrl(value: string) {
  if (!URL.canParse(value)) return false
  return ["http:", "https:"].includes(new URL(value).protocol)
}
