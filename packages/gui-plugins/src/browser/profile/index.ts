import { cp, lstat, readFile, realpath, rename, rm, stat } from "node:fs/promises"
import { generateKeyPairSync } from "node:crypto"
import { tmpdir } from "node:os"
import path from "node:path"
import electron, { app, type Extension, type Session } from "electron"
import { Schema } from "effect"
import type { Log, Storage } from "@opencode/plugin/gui/main"
import type { PagePermissions } from "../page-prompts"
import { guardSession } from "../session-guard"
import { extensionAccess, extensionCompatibility } from "./compatibility"
import { browserUserAgent, parseCookieFile, PROBE_COOKIE, type CookieRead } from "./cookie"
import { sweepSnapshots, type SnapshotScratch } from "./database"
import { writeCookies } from "./import"
import { createExtensionApis } from "./extension-api"
import { clearStaging, download, stageExtension, swapIn } from "./install"
import { createCookieMirror, type CookieMirror } from "./link"
import { cookiesPersist } from "./probe"
import { extensionDigest } from "./integrity"
import { createFilterGate, filterReady, filterKind } from "./filter-startup"
import { createPreviews } from "./previews"
import type { HandlePath } from "../disk"
import {
  displayName,
  extensionID,
  extensionIcon,
  extensionFiles,
  extensionPage,
  extensionPages,
  parseCrx,
  pinKey,
  readManifest,
  storeTarget,
  unzip,
  type ExtensionFiles,
  type Manifest,
} from "./extensions"
import { ReviewedGrants, type ImportResult, type InstallResult, type ProfileExtension, type SiteList } from "./ipc"
import {
  chromiumProfileDirectory,
  listSources,
  profileExtensions,
  readSource,
  readSourceHistory,
  readSourceHosts,
  windowsIcons,
} from "./sources"

/** The partition every page of the desktop browser shares, on disk under the app's user data. */
export const PARTITION = "persist:opencode-browser"

const StoredExtension = Schema.Struct({
  id: Schema.String,
  directory: Schema.String,
  enabled: Schema.Boolean,
  source: Schema.Literals(["folder", "store", "browser"]),
  origin: Schema.optional(Schema.String),
  localKey: Schema.optional(Schema.String),
  digest: Schema.optional(Schema.String),
  name: Schema.optional(Schema.String),
  grants: Schema.optional(ReviewedGrants),
})

type StoredExtension = typeof StoredExtension.Type

export type Profile = Awaited<ReturnType<typeof createBrowserProfile>>

/**
 * The desktop browser's one profile, for the whole desktop app rather than a session, project or server: its cookies,
 * site data and extensions. Pages of a server on this machine browse in it directly. Pages of another server need that
 * server's network, which Chromium sets per partition, so they browse in their own partition. `link` keeps that
 * partition's cookies in step with the profile's only while the user shares sign-ins with remote servers.
 */
export async function createBrowserProfile(input: {
  notificationTitle: (name: string) => string
  signal: AbortSignal
  storage: Storage
  log: Log
  changed: () => void
  cookiesChanged: () => void
  /** The plugin instance's file verifier, for previews and extension stylesheets. */
  verifier: HandlePath
}) {
  const session = electron.session.fromPartition(PARTITION)
  const previews = createPreviews(session, input.signal, input.verifier)
  session.setUserAgent(browserUserAgent(session.getUserAgent()))
  // Each tab's download handler by its web contents ID; the pane fills it. Guarded before any extension loads or pane
  // exists, so no page of the profile ever has Electron's default handlers, which grant every permission.
  const downloads = new Map<number, (item: Electron.DownloadItem) => void>()
  // Each tab's permission prompts by its web contents ID; the pane fills it too.
  const permissions = new Map<number, PagePermissions>()
  const unguard = guardSession(session, downloads, permissions)

  // Copies of cookie databases while they are read: other browsers' for an import or a site list, and the profile's own
  // for its start-up probe; see `snapshotDatabase`. Copies a crash left behind, here or in the temporary folder where
  // earlier versions made them, go now.
  const scratch: SnapshotScratch = {
    directory: path.join(app.getPath("userData"), "browser-import"),
    live: new Set(),
    log: (message, detail) => input.log.write("warn", message, detail),
  }

  void sweepSnapshots(scratch, [tmpdir()])
  const persistent = cookiesPersist(session, scratch)
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
  const changed = new Set<string>()
  const details = new Map<string, ProfileExtension>()
  // Browser icons by application path, read once; undefined for an application without one.
  const icons = new Map<string, string | undefined>()


  // What each package's files show, read once per directory and version: describing runs after every change.
  const scans = new Map<string, Promise<ExtensionFiles>>()

  const compatibilityOf = async (folder: string, manifest: Manifest) => {
    const key = `${folder}\n${manifest.version}`
    const scan = scans.get(key) ?? extensionFiles(folder, manifest)
    scans.set(key, scan)

    return extensionCompatibility(manifest, await scan)
  }

  const describe = async (record: StoredExtension): Promise<ProfileExtension | undefined> => {
    if (changed.has(record.id) || !record.digest) return {
      id: record.id, name: record.name ?? record.id, version: "", enabled: false, source: record.source,
      changed: true, access: [], compatibility: { level: "partial", missing: [] },
    }
    const manifest = await readManifest(record.directory)

    if (!manifest) return undefined
    const pages = extensionPages(manifest)
    const page = (file: string | undefined) => extensionPage(record.id, file)

    return {
      id: record.id,
      name: await displayName(record.directory, manifest),
      version: manifest.version,
      enabled: record.enabled && !errors.has(record.id) && !!session.extensions.getExtension(record.id),
      source: record.source,
      icon: await extensionIcon(record.directory, manifest),
      popup: page(pages.popup),
      options: page(pages.options),
      error: errors.get(record.id),
      compatibility: await compatibilityOf(record.directory, manifest),
      access: extensionAccess(manifest),
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

  // What creation set up before its first await. A step that fails releases it at once, so the next request, which
  // tries again, starts clean instead of stacking another cookie listener.
  const release = () => {
    unguard()
    session.cookies.off("changed", cookiesChanged)
    clearTimeout(settling)
    previews.dispose()
  }

  const apis = await createExtensionApis({
    notificationTitle: input.notificationTitle,
    session,
    partition: PARTITION,
    directory,
    storage: input.storage,
    log: input.log,
    changed: input.changed,
    verifier: input.verifier,
  }).catch((cause: unknown) => {
    release()
    throw cause
  })

  const closing = new AbortController()
  const lifetime = AbortSignal.any([input.signal, closing.signal])
  const filters = createFilterGate(lifetime, id => input.log.write("warn", "extension readiness unconfirmed; continuing navigation", { id }))

  const fallback = {
    reported: new Set<string>(),
    log: (id: string) => input.log.write("info", "filter engine shape not recognized; using registered request listeners", { id }),
  }

  const monitor = (extension: Extension) => {
    if (filterKind(extension)) {
      filters.start(extension.id, signal => filterReady(session, extension, signal, fallback))
    }
  }

  const load = async (record: StoredExtension) => {
    lifetime.throwIfAborted()
    const existing = session.extensions.getExtension(record.id)

    if (existing) return

    const managed = /^[a-p]{32}$/.test(record.id) && record.directory === path.join(directory, record.id) &&
      await realpath(record.directory).catch(() => undefined) === path.join(await realpath(directory), record.id)

    // Chromium writes compiled DNR rules into this reserved directory after a load. Never trust or load an on-disk
    // rules cache: regenerate it from the approved rules. A failure to clear it must fail the digest comparison.
    if (managed && record.digest) await rm(path.join(record.directory, "_metadata"), { recursive: true, force: true }).catch(() => undefined)

    if (!managed || !record.digest || await extensionDigest(record.directory) !== record.digest) {
      changed.add(record.id)

      return
    }

    changed.delete(record.id)
    lifetime.throwIfAborted()

    const loaded = await session.extensions.loadExtension(record.directory, { allowFileAccess: false }).then(
      (extension) => extension,
      (cause: unknown) => {
        errors.set(record.id, cause instanceof Error ? cause.message : String(cause))
        input.log.write("warn", "browser extension failed to load", { id: record.id, cause: String(cause) })
      },
    )

    if (loaded) {
      errors.delete(record.id)
      apis.activate(loaded)
      monitor(loaded)
    }
  }

  const unload = () =>
    session.extensions.getAllExtensions().forEach((extension) => session.extensions.removeExtension(extension.id))

  await clearStaging(directory)
    .then(async () => {
      // Preserve the shipped registration order and bounded file hashing. Readiness probes are not awaited here.
      for (const record of stored.value) if (record.enabled) await load(record)
    })
    .then(refresh)
    .catch((cause: unknown) => {
      closing.abort()
      apis.dispose()
      unload()
      release()
      throw cause
    })

  const add = async (record: StoredExtension): Promise<InstallResult> => {
    const extension = await session.extensions.loadExtension(record.directory, { allowFileAccess: false }).then(
      (value) => value,
      (cause: unknown) => (cause instanceof Error ? cause : new Error(String(cause))),
    )

    if (extension instanceof Error) return { type: "failed", reason: "load", message: extension.message }

    if (extension.id !== record.id) {
      session.extensions.removeExtension(extension.id)

      return { type: "failed", reason: "manifest" }
    }

    apis.activate(extension)
    monitor(extension)

    stored.set([...stored.value.filter((item) => item.id !== record.id), record])
    changed.delete(record.id)
    errors.delete(record.id)
    await refresh()
    const described = details.get(record.id)

    return described ? { type: "installed", extension: described } : { type: "failed", reason: "manifest" }
  }

  // One outstanding review across windows. The next install, removal of the extension, or shutdown invalidates it.
  let pending: { token: string; record: StoredExtension; staging: string } | undefined

  const discard = () => {
    const current = pending
    pending = undefined

    if (current) return rm(current.staging, { recursive: true, force: true }).catch(() => undefined)
  }

  const review = async (
    record: StoredExtension,
    fill: (staging: string) => Promise<boolean>,
    store?: "chrome" | "edge",
  ): Promise<InstallResult> => {
    const folder = record.directory
    const failed: InstallResult = { type: "failed", reason: record.source === "store" ? "download" : "manifest" }
    const previous = stored.value.find((item) => item.directory === folder || item.id === record.id)

    if (previous && (previous.source !== record.source || previous.directory !== folder || previous.id !== record.id || previous.origin !== record.origin))
      return { type: "failed", reason: "collision" }
    const staging = await stageExtension(directory, fill)

    if (!staging) return failed
    const digest = await extensionDigest(staging)
    const manifest = digest && await readManifest(staging)

    if (!digest || !manifest || manifest.theme !== undefined) {
      await rm(staging, { recursive: true, force: true })

      return failed
    }

    const name = await displayName(staging, manifest)
    const token = crypto.randomUUID()
    const compatibility = extensionCompatibility(manifest, await extensionFiles(staging, manifest))
    // The public-suffix list is needed only while preparing a review, not to start the browser profile.
    const { reviewAccess } = await import("./review")
    const summary = reviewAccess(manifest, previous?.grants)
    pending = { token, staging, record: { ...record, name, digest, grants: summary.grants } }

    return { type: compatibility.level === "unsupported" ? "unsupported" : "review", token, name, id: record.id, store,
      icon: await extensionIcon(staging, manifest), replaces: previous?.name ?? previous?.id, compatibility,
      ...summary.grants, sites: summary.sites, added: summary.added,
    }
  }

  const approve = async (token: string): Promise<InstallResult> => {
    if (!pending || pending.token !== token) return { type: "failed", reason: "expired" }
    const { staging, record } = pending
    pending = undefined

    if (await extensionDigest(staging) !== record.digest) {
      await rm(staging, { recursive: true, force: true })

      return { type: "failed", reason: "expired" }
    }

    const folder = record.directory
    const previous = stored.value.find((item) => item.id === record.id)
    const previousVersion = previous && details.get(previous.id)?.version

    // Chromium keeps the loaded copy's files open, and Windows moves no open file.
    if (previous) {
      apis.forget(previous.id)

      if (session.extensions.getExtension(previous.id)) session.extensions.removeExtension(previous.id)
    }

    const swapped = await swapIn(staging, folder)

    if (!swapped) {
      await rm(staging, { recursive: true, force: true }).catch(() => undefined)

      if (previous?.enabled) await load(previous)

      return { type: "failed", reason: "manifest" }
    }

    const restoreMenus = previous && apis.resetMenus(previous.id)
    const finishInstall = apis.prepareInstall(record.id, previousVersion)

    const result = await add(record).catch((cause: unknown) => {
      finishInstall(false)
      throw cause
    })

    finishInstall(result.type === "installed")

    if (result.type === "installed") {

      if (swapped.backup) void rm(swapped.backup, { recursive: true, force: true }).catch(() => undefined)

      return result
    }

    // The new copy did not load: it goes, and the previous one, if any, comes back as it was.
    restoreMenus?.()
    await rm(folder, { recursive: true, force: true }).catch(() => undefined)

    if (swapped.backup) await rename(swapped.backup, folder).catch(() => undefined)

    if (previous?.enabled) await load(previous)
    await refresh()

    return result
  }

  const importCookies = async (read: CookieRead, chosen = false): Promise<ImportResult> => {
    // Imported sign-ins would be gone at the next start.
    if (!(await persistent)) return { type: "failed", reason: "storage" }

    return writeCookies(session, read, chosen)
  }

  return {
    session,
    partition: PARTITION,
    /** Each tab's download handler by its web contents ID, which the profile's one `will-download` listener calls. */
    downloads,
    /** Each tab's permission prompts by its web contents ID, which the profile's permission handlers call. */
    permissions,
    previews,
    waitForFilters: filters.wait,
    /** The pane's tabs and windows as extensions see them; the pane registers each tab of the profile. */
    extensionTabs: apis.tabs,
    extensionMenu: apis.menu,
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
    /** The sites a browser profile has cookies for, from their hosts alone; see `SiteList`. */
    async sites(source: string, profile: string): Promise<SiteList> {
      const hosts = await readSourceHosts(source, profile, scratch)

      if ("failure" in hosts) return { type: "failed", reason: hosts.failure === "key" ? "read" : hosts.failure }
      // The public-suffix list loads only when a list or a chosen import needs it, not to start the browser profile.
      const { groupSites } = await import("./sites")

      // Safari records no last use, so its list is by name.
      return { type: "listed", sites: groupSites(hosts, Date.now() / 1000), order: hosts.some((host) => host.used > 0) ? "recent" : "name" }
    },
    /** Imports a browser profile's cookies, or with `sites` only those of the chosen sites. */
    async importBrowser(source: string, profile: string, sites?: readonly string[]): Promise<ImportResult> {
      const keep = sites ? (await import("./sites")).siteFilter(sites) : undefined
      const read = await readSource(source, profile, scratch, keep)

      if ("failure" in read) return { type: "failed", reason: read.failure }

      return importCookies(read, !!sites)
    },
    /**
     * The pages of a browser profile's history for an import, or with `sites` only the chosen sites'. None when the
     * history cannot be read, as Safari's without Full Disk Access: the log says why, without any address.
     */
    async readHistory(source: string, profile: string, sites?: readonly string[]) {
      const keep = sites ? (await import("./sites")).siteFilter(sites) : undefined
      const read = await readSourceHistory(source, profile, scratch, keep)

      if (!("failure" in read)) return read
      input.log.write("warn", "another browser's history could not be read", { source, reason: read.failure })

      return []
    },
    async importFile(file: string): Promise<ImportResult> {
      // A cookie export is a few megabytes at most; anything far larger is not one.
      const size = await stat(file).then(
        (info) => (info.isFile() ? info.size : Infinity),
        () => Infinity,
      )

      const text = size <= 32 * 1024 * 1024 ? await readFile(file, "utf8").catch(() => undefined) : undefined

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
      // Installed background workers are registrations in this partition too. Clear site workers, not the programs
      // that back the user's installed extensions. All other origin storage, including cookies, is still cleared.
      const excludeOrigins = session.extensions.getAllExtensions().map((extension) => extension.url)

      if (excludeOrigins.length) {
        await session.clearData({ excludeOrigins, originMatchingMode: "origin-in-all-contexts" })
        await session.clearStorageData({ storages: ["cookies", "filesystem", "indexdb", "localstorage", "shadercache", "cachestorage"] })
      } else await session.clearStorageData()
      await session.clearCache()
      // HTTP sign-ins (Basic, Digest, NTLM) live in Chromium's auth cache, which neither of those clears.
      await session.clearAuthCache()
      // Remote servers' pages sign out too, whether or not they shared the profile's sign-ins. Their proxy's own
      // sign-in is answered again on demand (network.ts).
      await Promise.all([...links.keys()].map((other) => Promise.all([other.clearStorageData(), other.clearAuthCache()])))
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
              installed: stored.value.some((record) => !changed.has(record.id) && record.source === "browser" && record.origin === path.dirname(item.directory)),
              compatibility: await compatibilityOf(item.directory, manifest),
              access: extensionAccess(manifest),
            },
          ]
        }),
      )

      return listed.flat().toSorted((a, b) => a.name.localeCompare(b.name))
    },
    async install(
      request:
        | { kind: "approve"; token: string }
        | { kind: "folder"; path: string }
        | { kind: "store"; url: string }
        | { kind: "browser"; source: string; profile: string; id: string },
    ): Promise<InstallResult> {
      if (request.kind === "approve") return approve(request.token)
      await discard()

      if (request.kind !== "store") {
        const profile = request.kind === "browser" && await chromiumProfileDirectory(request.source, request.profile)

        const folder = request.kind === "folder" ? await realpath(request.path).catch(() => undefined) :
          profile && (await profileExtensions(profile)).find((item) => item.id === request.id)?.directory

        if (!folder) return { type: "failed", reason: "manifest" }
        // An unpacked manifest cannot authenticate its key. Give each local source a private profile identity, stable
        // across updates from that source; neither the source nor a claimed store ID chooses which storage it sees.
        const origin = request.kind === "browser" ? path.dirname(folder) : folder
        const previous = stored.value.find((record) => record.source === request.kind && record.origin === origin)

        const key = previous?.localKey ? Buffer.from(previous.localKey, "base64") :
          generateKeyPairSync("ec", { namedCurve: "prime256v1" }).publicKey.export({ format: "der", type: "spki" })

        const id = extensionID(key)

        return review({ id, enabled: true, source: request.kind, origin, localKey: key.toString("base64"), directory: path.join(directory, id) }, async (staging) => {
          await cp(folder, staging, {
            recursive: true,
            filter: async (item) => path.basename(item) !== "_metadata" && !(await lstat(item)).isSymbolicLink(),
          })

          return pinKey(staging, key)
        })
      }

      const target = storeTarget(request.url)

      if (!target) return { type: "failed", reason: "download" }
      const crx = await download(session, target)
      const parsed = crx && parseCrx(crx, target.id)

      if (!parsed) return { type: "failed", reason: "download" }

      return review({ id: target.id, directory: path.join(directory, target.id), enabled: true, source: "store" }, async (staging) => {
        await unzip(parsed.zip, staging)
        // Electron discards store metadata on unpacked loads. Remove it before approval, not from the digest check.
        await rm(path.join(staging, "_metadata"), { recursive: true, force: true })

        return pinKey(staging, parsed.key)
      }, target.store)
    },
    async remove(id: string) {
      filters.remove(id)

      if (pending?.record.id === id) await discard()
      const record = stored.value.find((item) => item.id === id)

      if (session.extensions.getExtension(id)) session.extensions.removeExtension(id)
      apis.forget(id)
      apis.uninstall(id)
      stored.set(stored.value.filter((item) => item.id !== id))
      errors.delete(id)

      // Only copies this app made are deleted; a folder the user loaded stays where it is.
      if (record && (record.source !== "folder" || record.localKey) && record.directory === path.join(directory, id))
        await rm(record.directory, { recursive: true, force: true }).catch(() => undefined)
      await refresh()
    },
    async enable(id: string, enabled: boolean) {
      const record = stored.value.find((item) => item.id === id)

      if (!record) return
      const next = { ...record, enabled }
      stored.set(stored.value.map((item) => (item.id === id ? next : item)))

      if (enabled) await load(next)

      if (!enabled) filters.remove(id)

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
      closing.abort()
      void discard()
      links.forEach((_mirror, other) => void unmirror(other, false))
      links.clear()
      apis.dispose()
      unload()
      release()
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
