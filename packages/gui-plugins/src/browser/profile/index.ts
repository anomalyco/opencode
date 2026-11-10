import { cp, mkdir, readFile, rm } from "node:fs/promises"
import path from "node:path"
import electron, { app, type Session } from "electron"
import { Schema } from "effect"
import type { Log, Storage } from "@opencode/plugin/gui/main"
import { fileURLWithin } from "../policy"
import { browserUserAgent, cookieDetails, parseCookieFile, type CookieRead } from "./cookie"
import {
  displayName,
  extensionIcon,
  extensionID,
  extensionPages,
  parseCrx,
  pinKey,
  readManifest,
  storeDownloadURL,
  storeTarget,
  unzip,
} from "./extensions"
import type { ImportResult, InstallResult, ProfileExtension } from "./ipc"
import { chromiumProfileDirectory, listSources, profileExtensions, readSource, windowsIcons } from "./sources"

/** The partition every page of the desktop browser shares, on disk under the app's user data. */
export const PARTITION = "persist:opencode-browser"

const StoredExtension = Schema.Struct({
  id: Schema.String,
  directory: Schema.String,
  enabled: Schema.Boolean,
  source: Schema.Literals(["folder", "store", "browser"]),
})

type StoredExtension = typeof StoredExtension.Type

export type Profile = Awaited<ReturnType<typeof createBrowserProfile>>

/**
 * The desktop browser's one profile, for the whole desktop app rather than a session, project or server: its cookies,
 * site data and extensions. Pages of a server on this machine browse in it directly. Pages of another server need that
 * server's network, which Chromium sets per partition, so they browse in their own partition that `link` keeps in step
 * with the profile's cookies.
 */
export async function createBrowserProfile(input: { storage: Storage; log: Log; changed: () => void }) {
  const session = electron.session.fromPartition(PARTITION)
  session.setUserAgent(browserUserAgent(session.getUserAgent()))
  const stored = input.storage.store("extensions", { schema: Schema.Array(StoredExtension), initial: [] })
  const directory = path.join(app.getPath("userData"), "browser-extensions")
  const errors = new Map<string, string>()
  const details = new Map<string, ProfileExtension>()
  const roots = new Map<number, () => readonly string[]>()
  // Browser icons by application path, read once; undefined for an application without one.
  const icons = new Map<string, string | undefined>()

  // Documents are guarded by the page; subresources (img, script, fetch) must not read file: URLs outside the roots
  // of the page that asked either. One listener serves every page, so each page registers its roots by id.
  session.webRequest.onBeforeRequest({ urls: ["file://*/*"] }, (request, callback) => {
    const allowed = request.webContentsId === undefined ? undefined : roots.get(request.webContentsId)
    callback({ cancel: !fileURLWithin(request.url, allowed?.() ?? []) })
  })

  const describe = async (record: StoredExtension): Promise<ProfileExtension | undefined> => {
    const manifest = await readManifest(record.directory)

    if (!manifest) return undefined
    const pages = extensionPages(manifest)

    const page = (file: string | undefined) =>
      file === undefined ? undefined : new URL(file.replace(/^\//, ""), `chrome-extension://${record.id}/`).href

    return {
      id: record.id,
      name: await displayName(record.directory, manifest),
      version: manifest.version,
      enabled: record.enabled,
      source: record.source,
      icon: await extensionIcon(record.directory, manifest),
      popup: page(pages.popup),
      options: page(pages.options),
      error: errors.get(record.id),
    }
  }

  const refresh = async () => {
    const described = await Promise.all(stored.value.map(describe))
    details.clear()
    described.forEach((item) => {
      if (item) details.set(item.id, item)
    })
    input.changed()
  }

  const load = async (record: StoredExtension) => {
    if (session.extensions.getExtension(record.id)) return

    const loaded = await session.extensions.loadExtension(record.directory, { allowFileAccess: false }).then(
      (extension) => extension,
      (cause: unknown) => {
        errors.set(record.id, cause instanceof Error ? cause.message : String(cause))
        input.log.write("warn", "browser extension failed to load", { id: record.id, cause: String(cause) })
      },
    )

    if (loaded) errors.delete(record.id)
  }

  await Promise.all(stored.value.filter((record) => record.enabled).map(load))
  await refresh()

  /** Loads a directory as a new extension and remembers it, or reports why it is not one. */
  const add = async (folder: string, source: StoredExtension["source"]): Promise<InstallResult> => {
    const manifest = await readManifest(folder)

    if (!manifest || manifest.theme !== undefined) return { type: "failed", reason: "manifest" }

    const extension = await session.extensions.loadExtension(folder, { allowFileAccess: false }).then(
      (value) => value,
      (cause: unknown) => (cause instanceof Error ? cause : new Error(String(cause))),
    )

    if (extension instanceof Error) return { type: "failed", reason: "load", message: extension.message }
    const record = { id: extension.id, directory: folder, enabled: true, source }
    stored.set([...stored.value.filter((item) => item.id !== record.id), record])
    errors.delete(record.id)
    await refresh()
    const described = details.get(record.id)

    return described ? { type: "installed", extension: described } : { type: "failed", reason: "manifest" }
  }

  const importCookies = async (read: CookieRead): Promise<ImportResult> => {
    const now = Date.now() / 1000
    const writes = read.cookies.flatMap((cookie) => cookieDetails(cookie, now) ?? [])

    const results = await Promise.all(
      writes.map((cookie) =>
        session.cookies.set(cookie).then(
          () => true,
          () => false,
        ),
      ),
    )

    await session.cookies.flushStore()
    const imported = results.filter(Boolean).length

    return {
      type: "imported",
      imported,
      skipped: read.cookies.length - writes.length,
      protected: read.protected,
      failed: read.failed + writes.length - imported,
    }
  }

  return {
    session,
    partition: PARTITION,
    /** Lets one page load file: subresources inside `fileRoots`; returns the release. */
    allowFiles(webContentsId: number, fileRoots: () => readonly string[]) {
      roots.set(webContentsId, fileRoots)

      return () => void roots.delete(webContentsId)
    },
    /** Extensions loaded now, whose pages may open in a tab. */
    extensionIDs: () => session.extensions.getAllExtensions().map((extension) => extension.id),
    extensions: () => stored.value.flatMap((record) => details.get(record.id) ?? []),
    /** The browsers to import from, the one used last first, each with its application's icon. */
    async sources() {
      const listed = await listSources()

      const missing = listed.flatMap((source) =>
        source.application && !icons.has(source.application) ? [source.application] : [],
      )

      // Each application's icon is read once; an application without one is not asked again either.
      const read = await applicationIcons(missing)
      missing.forEach((file) => icons.set(file, read.get(file)))

      return listed.map((source) => ({
        id: source.id,
        name: source.name,
        engine: source.engine,
        profiles: source.profiles,
        icon: source.application ? icons.get(source.application) : undefined,
      }))
    },
    async importBrowser(source: string, profile: string): Promise<ImportResult> {
      const read = await readSource(source, profile)

      if ("failure" in read) return { type: "failed", reason: read.failure }

      return importCookies(read)
    },
    async importFile(file: string): Promise<ImportResult> {
      const text = await readFile(file, "utf8").catch(() => undefined)

      if (text === undefined) return { type: "failed", reason: "read" }
      const read = parseCookieFile(text)

      return read ? importCookies(read) : { type: "failed", reason: "format" }
    },
    async summary() {
      const cookies = await session.cookies.get({})

      return { cookies: cookies.length, sites: new Set(cookies.map((cookie) => siteOf(cookie.domain ?? ""))).size }
    },
    async clear() {
      await session.clearStorageData()
      await session.clearCache()
    },
    async browserExtensions(source: string, profile: string) {
      const folder = await chromiumProfileDirectory(source, profile)
      const found = folder ? await profileExtensions(folder) : []

      const listed = await Promise.all(
        found.map(async (item) => {
          const manifest = await readManifest(item.directory)

          if (!manifest || manifest.theme !== undefined) return []

          return [
            {
              id: item.id,
              name: await displayName(item.directory, manifest),
              version: manifest.version,
              icon: await extensionIcon(item.directory, manifest),
              installed: stored.value.some((record) => record.id === item.id),
            },
          ]
        }),
      )

      return listed.flat().toSorted((a, b) => a.name.localeCompare(b.name))
    },
    async install(
      request:
        | { kind: "folder"; path: string }
        | { kind: "store"; url: string }
        | { kind: "browser"; source: string; profile: string; id: string },
    ): Promise<InstallResult> {
      if (request.kind === "folder") return add(request.path, "folder")

      if (request.kind === "browser") {
        const folder = await chromiumProfileDirectory(request.source, request.profile)
        const found = folder ? (await profileExtensions(folder)).find((item) => item.id === request.id) : undefined

        if (!found) return { type: "failed", reason: "manifest" }
        // A copy, so the other browser updating or removing it leaves this one working.
        const target = path.join(directory, request.id)
        await rm(target, { recursive: true, force: true })
        await mkdir(directory, { recursive: true })
        await cp(found.directory, target, { recursive: true, filter: (item) => path.basename(item) !== "_metadata" })

        return add(target, "browser")
      }

      const target = storeTarget(request.url)

      if (!target) return { type: "failed", reason: "download" }

      const response = await fetch(storeDownloadURL(target, process.versions.chrome ?? "140.0.0.0")).catch(
        () => undefined,
      )

      if (!response?.ok) return { type: "failed", reason: "download" }
      const crx = parseCrxSafely(new Uint8Array(await response.arrayBuffer()))

      if (!crx) return { type: "failed", reason: "download" }
      // Named by the id the package's key gives, which is the id Electron derives once `key` is in the manifest.
      const folder = path.join(directory, crx.key ? extensionID(crx.key) : target.id)
      await rm(folder, { recursive: true, force: true })
      await mkdir(folder, { recursive: true })
      await unzip(crx.zip, folder)

      if (crx.key) await pinKey(folder, crx.key)

      return add(folder, "store")
    },
    async remove(id: string) {
      const record = stored.value.find((item) => item.id === id)

      if (session.extensions.getExtension(id)) session.extensions.removeExtension(id)
      stored.set(stored.value.filter((item) => item.id !== id))
      errors.delete(id)

      // Only copies this app made are deleted; a folder the user loaded stays where it is.
      if (record && record.source !== "folder" && path.dirname(record.directory) === directory)
        await rm(record.directory, { recursive: true, force: true }).catch(() => undefined)
      await refresh()
    },
    async enable(id: string, enabled: boolean) {
      const record = stored.value.find((item) => item.id === id)

      if (!record) return
      const next = { ...record, enabled }
      stored.set(stored.value.map((item) => (item.id === id ? next : item)))

      if (enabled) await load(next)

      if (!enabled && session.extensions.getExtension(id)) session.extensions.removeExtension(id)
      await refresh()
    },
    /**
     * Keeps another partition's cookies in step with the profile's, both ways, for pages that need a remote server's
     * network. Returns the unlink. Site storage and extensions stay with the profile: Chromium shares neither across
     * partitions, and in-memory partitions cannot load extensions.
     */
    async link(other: Session) {
      other.setUserAgent(session.getUserAgent())
      const pending = new Set<string>()

      const mirror =
        (target: Session) => (_event: Electron.Event, cookie: Electron.Cookie, cause: string, removed: boolean) => {
          // An overwrite removes the old value just before it inserts the new one, which the insert carries over.
          if (cause === "overwrite" || cause === "expired-overwrite") return
          const key = `${cookie.domain}\n${cookie.path}\n${cookie.name}\n${removed ? "" : cookie.value}`

          // The write this mirror made comes back as a change of the target; it goes no further.
          if (pending.delete(key)) return
          pending.add(key)

          const write = removed
            ? target.cookies.remove(electronCookieURL(cookie), cookie.name)
            : target.cookies.set(electronCookieDetails(cookie))

          void write.catch(() => pending.delete(key))
        }

      const toOther = mirror(other)
      const toProfile = mirror(session)
      const cookies = await session.cookies.get({})
      await Promise.all(
        cookies.map((cookie) => other.cookies.set(electronCookieDetails(cookie)).catch(() => undefined)),
      )
      session.cookies.on("changed", toOther)
      other.cookies.on("changed", toProfile)

      return () => {
        session.cookies.off("changed", toOther)
        other.cookies.off("changed", toProfile)
      }
    },
    dispose() {
      session.webRequest.onBeforeRequest(null)
      roots.clear()
      session.extensions.getAllExtensions().forEach((extension) => session.extensions.removeExtension(extension.id))
    },
  }
}

/** Applications' icons as the system shows them, by path; a file the system has no icon for is left out. */
async function applicationIcons(files: readonly string[]) {
  if (process.platform === "win32") return windowsIcons(files)

  const read = await Promise.all(
    files.map(async (file) => {
      const image = await app.getFileIcon(file, { size: "normal" }).catch(() => undefined)

      return image && !image.isEmpty() ? [[file, image.toDataURL()] as const] : []
    }),
  )

  return new Map(read.flat())
}

function parseCrxSafely(data: Uint8Array) {
  try {
    return parseCrx(data)
  } catch {
    return undefined
  }
}

function electronCookieDetails(cookie: Electron.Cookie) {
  const details: Electron.CookiesSetDetails = {
    url: electronCookieURL(cookie),
    name: cookie.name,
    value: cookie.value,
    path: cookie.path,
    secure: cookie.secure,
    httpOnly: cookie.httpOnly,
    sameSite: cookie.sameSite,
  }

  // A host-only cookie takes its host from the URL, and a session cookie has no expiry.
  if (!cookie.hostOnly) details.domain = cookie.domain

  if (!cookie.session) details.expirationDate = cookie.expirationDate

  return details
}

function electronCookieURL(cookie: Electron.Cookie) {
  const host = (cookie.domain ?? "").replace(/^\./, "")
  const bracketed = host.includes(":") && !host.startsWith("[") ? `[${host}]` : host

  return `${cookie.secure ? "https" : "http"}://${bracketed}${cookie.path ?? "/"}`
}

/** The registrable part of a cookie's domain, roughly: its last two labels. Only counts sites for the summary. */
function siteOf(domain: string) {
  return domain.replace(/^\./, "").split(".").slice(-2).join(".")
}
