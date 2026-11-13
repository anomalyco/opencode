import { cp, mkdir, readFile, realpath, rm } from "node:fs/promises"
import path from "node:path"
import electron, { app, type Session } from "electron"
import { Schema } from "effect"
import type { Log, Storage } from "@opencode/plugin/gui/main"
import { fileURLWithin } from "../policy"
import { extensionCompatibility } from "./compatibility"
import { browserUserAgent, cookieDetails, parseCookieFile, PROBE_COOKIE, type CookieRead } from "./cookie"
import { snapshotDatabase } from "./database"
import { createExtensionApis } from "./extension-api"
import { createFileGuard } from "./file-guard"
import { createCookieMirror, type CookieMirror } from "./link"
import {
  displayName,
  extensionIcon,
  extensionID,
  extensionFiles,
  extensionPage,
  extensionPages,
  parseCrx,
  pinKey,
  readManifest,
  storeDownloadURL,
  storeTarget,
  unzip,
  type ExtensionFiles,
  type Manifest,
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
export async function createBrowserProfile(input: {
  storage: Storage
  log: Log
  changed: () => void
  cookiesChanged: () => void
}) {
  const session = electron.session.fromPartition(PARTITION)
  session.setUserAgent(browserUserAgent(session.getUserAgent()))
  const persistent = cookiesPersist(session)
  let settling: ReturnType<typeof setTimeout> | undefined

  // A page sets or clears cookies in bursts; the cookie count hears once the burst settles. The start-up probe is no
  // one's cookie, so it never moves the count.
  const cookiesChanged = (_event: Electron.Event, cookie: Electron.Cookie) => {
    if (cookie.domain?.replace(/^\./, "") === PROBE_COOKIE.host) return
    clearTimeout(settling)
    settling = setTimeout(input.cookiesChanged, 400)
  }

  session.cookies.on("changed", cookiesChanged)
  const stored = input.storage.store("extensions", { schema: Schema.Array(StoredExtension), initial: [] })
  const directory = path.join(app.getPath("userData"), "browser-extensions")
  // Off until the user turns it on: a remote server's operator could use every sign-in and write cookies back.
  const sharing = input.storage.store("remote-sign-ins", { schema: Schema.Boolean, initial: false })
  // Remote servers' partitions, each with its cookie mirror while sign-ins are shared.
  const links = new Map<Session, CookieMirror | undefined>()

  const mirror = async (other: Session) => {
    if (links.get(other) || !links.has(other)) return
    const started = createCookieMirror({ profile: session, other })
    links.set(other, started)
    await started.started
  }

  const unmirror = async (other: Session, forget: boolean) => {
    const current = links.get(other)

    if (!current) return

    if (links.has(other)) links.set(other, undefined)
    await current.stop(forget)
  }

  const errors = new Map<string, string>()
  const details = new Map<string, ProfileExtension>()
  const roots = new Map<number, () => readonly string[]>()
  // Browser icons by application path, read once; undefined for an application without one.
  const icons = new Map<string, string | undefined>()

  // Documents are guarded by the page; subresources (img, script, fetch) must not read file: URLs outside the roots
  // of the page that asked either. One guard serves every page, so each page registers its roots by id.
  const stopFileGuard = createFileGuard({
    session,
    allowed: (request) => {
      const allowed = request.webContentsId === undefined ? undefined : roots.get(request.webContentsId)

      return fileURLWithin(request.url, allowed?.() ?? [])
    },
  })

  // What each package's files show, read once per directory and version: describing runs after every change.
  const scans = new Map<string, Promise<ExtensionFiles>>()

  const compatibilityOf = async (folder: string, manifest: Manifest) => {
    const key = `${folder}\n${manifest.version}`
    const scan = scans.get(key) ?? extensionFiles(folder, manifest)
    scans.set(key, scan)

    return extensionCompatibility(manifest, await scan)
  }

  const describe = async (record: StoredExtension): Promise<ProfileExtension | undefined> => {
    const manifest = await readManifest(record.directory)

    if (!manifest) return undefined
    const pages = extensionPages(manifest)
    const page = (file: string | undefined) => extensionPage(record.id, file)

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
      compatibility: await compatibilityOf(record.directory, manifest),
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

  const apis = await createExtensionApis({
    session,
    partition: PARTITION,
    directory,
    storage: input.storage,
    log: input.log,
    changed: input.changed,
  })

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

  /**
   * Loads a directory as a new extension and remembers it, or reports why it is not one. One that will not work here
   * loads only with `force`; otherwise a copy this app made is deleted again.
   */
  const add = async (folder: string, source: StoredExtension["source"], force = false): Promise<InstallResult> => {
    const manifest = await readManifest(folder)

    if (!manifest || manifest.theme !== undefined) return { type: "failed", reason: "manifest" }
    const compatibility = await compatibilityOf(folder, manifest)
    // Installing one again, such as an update, keeps it, as the user added it before.
    const known = stored.value.some((record) => record.directory === folder)

    if (compatibility.level === "unsupported" && !force && !known) {
      const name = await displayName(folder, manifest)
      const icon = await extensionIcon(folder, manifest)

      if (source !== "folder") await rm(folder, { recursive: true, force: true }).catch(() => undefined)

      return { type: "unsupported", name, icon, compatibility }
    }

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
    // Imported sign-ins would be gone at the next start.
    if (!(await persistent)) return { type: "failed", reason: "storage" }
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
      skipped: (read.skipped ?? 0) + read.cookies.length - writes.length,
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
    /** The pane's tabs and windows as extensions see them; the pane registers each tab of the profile. */
    extensionTabs: apis.tabs,
    /** Extensions loaded now, whose pages may open in a tab. */
    extensionIDs: () => session.extensions.getAllExtensions().map((extension) => extension.id),
    extensions: () =>
      stored.value.flatMap((record) => {
        const described = details.get(record.id)
        const loaded = session.extensions.getExtension(record.id)
        const action = loaded ? apis.action(loaded) : undefined

        if (!described) return []

        return action ? [{ ...described, action }] : [described]
      }),
    /** The user chose an extension in a window's extensions menu; see `ExtensionApis.click`. */
    clickExtension: apis.click,
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
      const saved = await persistent
      const cookies = await session.cookies.get({})

      return { cookies: cookies.length, persistent: saved }
    },
    async clear() {
      await session.clearStorageData()
      await session.clearCache()
      // Remote servers' pages sign out too, whether or not they shared the profile's sign-ins.
      await Promise.all([...links.keys()].map((other) => other.clearStorageData()))
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
              compatibility: await compatibilityOf(item.directory, manifest),
            },
          ]
        }),
      )

      return listed.flat().toSorted((a, b) => a.name.localeCompare(b.name))
    },
    async install(
      request:
        | { kind: "folder"; path: string; force?: boolean }
        | { kind: "store"; url: string; force?: boolean }
        | { kind: "browser"; source: string; profile: string; id: string; force?: boolean },
    ): Promise<InstallResult> {
      if (request.kind === "folder") return add(request.path, "folder", request.force)

      if (request.kind === "browser") {
        const folder = await chromiumProfileDirectory(request.source, request.profile)
        const found = folder ? (await profileExtensions(folder)).find((item) => item.id === request.id) : undefined

        if (!found) return { type: "failed", reason: "manifest" }
        // A copy, so the other browser updating or removing it leaves this one working.
        const target = path.join(directory, request.id)
        await rm(target, { recursive: true, force: true })
        await mkdir(directory, { recursive: true })
        await cp(found.directory, target, { recursive: true, filter: (item) => path.basename(item) !== "_metadata" })

        return add(target, "browser", request.force)
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

      return add(folder, "store", request.force)
    },
    async remove(id: string) {
      const record = stored.value.find((item) => item.id === id)

      if (session.extensions.getExtension(id)) session.extensions.removeExtension(id)
      apis.forget(id)
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

      if (!enabled) apis.forget(id)
      await refresh()
    },
    /** Whether remote servers' pages share the profile's sign-ins; see `link`. */
    remoteSignIns: () => sharing.value,
    /**
     * Turns sharing sign-ins with remote servers on or off for every linked partition at once. Turning it off stops
     * each mirror and removes the shared cookies from the remote partitions.
     */
    async shareSignIns(enabled: boolean) {
      sharing.set(enabled)
      await Promise.all([...links.keys()].map((other) => (enabled ? mirror(other) : unmirror(other, true))))
      input.changed()
    },
    /**
     * Registers the partition of a remote server's pages, which need that server's network. Only while the user
     * shares sign-ins with remote servers (`remoteSignIns`) does its cookie store mirror the profile's, both ways;
     * otherwise it gets no cookie of the profile and writes none back. Returns the unlink. Site storage and extensions
     * stay with the profile: Chromium shares neither across partitions, and in-memory partitions cannot load
     * extensions.
     */
    async link(other: Session) {
      other.setUserAgent(session.getUserAgent())
      links.set(other, undefined)

      if (sharing.value) await mirror(other)

      return () => {
        void unmirror(other, false)
        links.delete(other)
      }
    },
    dispose() {
      links.forEach((_mirror, other) => void unmirror(other, false))
      links.clear()
      session.cookies.off("changed", cookiesChanged)
      clearTimeout(settling)
      stopFileGuard()
      apis.dispose()
      roots.clear()
      session.extensions.getAllExtensions().forEach((extension) => session.extensions.removeExtension(extension.id))
    },
  }
}

/** Applications' icons as the system shows them, by path; a file the system has no icon for is left out. */
async function applicationIcons(files: readonly string[]) {
  if (process.platform === "win32") return windowsIcons(files)

  // On macOS `getFileIcon` answers by file type, the generic application icon for every bundle. Quick Look draws the
  // bundle's own icon, but only at its real path: Safari's /Applications entry is a symlink into a system volume.
  const read = await Promise.all(
    files.map(async (file) => {
      const image = await realpath(file)
        .then((bundle) => electron.nativeImage.createThumbnailFromPath(bundle, { width: 64, height: 64 }))
        .catch(() => undefined)

      return image && !image.isEmpty() ? [[file, image.toDataURL()] as const] : []
    }),
  )

  return new Map(read.flat())
}

/**
 * Whether the profile's cookies reach its database. With cookie encryption on, Chromium writes no cookie at all while
 * the system key store refuses its key: a denied Keychain prompt, or a locked keyring. Writes one short-lived cookie,
 * flushes it and looks for it on disk. When the check itself cannot run, it says they do.
 */
async function cookiesPersist(session: Session) {
  const written = await session.cookies
    .set({ url: PROBE_COOKIE.url, name: PROBE_COOKIE.name, value: "1", expirationDate: Date.now() / 1000 + 600 })
    .then(() => session.cookies.flushStore())
    .then(
      () => true,
      () => false,
    )

  if (!written || !session.storagePath) return true

  const storage = session.storagePath

  // Chromium keeps a partition's database under Network/ on some systems and beside it on others.
  const counts = await Promise.all(
    [path.join(storage, "Network", "Cookies"), path.join(storage, "Cookies")].map((file) =>
      snapshotDatabase(file, (db) =>
        db.prepare("SELECT count(*) AS count FROM cookies WHERE host_key = ? AND name = ?").get(PROBE_COOKIE.host, PROBE_COOKIE.name),
      )
        .then((row) => Number(row?.count ?? 0))
        .catch(() => undefined),
    ),
  )

  await session.cookies
    .remove(PROBE_COOKIE.url, PROBE_COOKIE.name)
    .then(() => session.cookies.flushStore())
    .catch(() => undefined)

  const read = counts.filter((count) => count !== undefined)

  return read.length === 0 || read.some((count) => count > 0)
}

function parseCrxSafely(data: Uint8Array) {
  try {
    return parseCrx(data)
  } catch {
    return undefined
  }
}
