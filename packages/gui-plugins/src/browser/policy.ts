// URL policy shared by the pane and page. Electron-free so it stays unit-testable under Bun.

import { Browser } from "@opencode/plugin-browser/rpc"
import { encodeFilePath } from "@opencode/util/path"
import { remotePath } from "./remote-address"
import { artifactAddress } from "./artifact-link"
import { windowsPreviewSegment } from "@opencode/plugin-browser/preview-path"

export function destinationOrigin(input: string) {
  if (!URL.canParse(input)) return
  const url = new URL(input)

  return /^https?:$/.test(url.protocol) && !url.username && !url.password ? url.origin : undefined
}

/** A file URL for this machine: no host, so UNC shares and remote hosts are rejected. */
export function localFileURL(input: string) {
  if (!URL.canParse(input)) return
  const url = new URL(input)

  return url.protocol === "file:" && !url.hostname ? url.href : undefined
}

/** A filesystem path in the form paths compare in: slashes, no leading slash before a drive, any case on Windows. */
function canonicalPath(path: string) {
  const value = path.replaceAll("\\", "/").replace(/^\/([A-Za-z]:\/)/, "$1")

  return process.platform === "win32" ? value.toLowerCase() : value
}

/** The filesystem path a file URL names, or undefined when its escapes do not decode or could step out of a folder. */
function filePath(url: URL) {
  // An escaped separator or dot segment decodes into a path the URL parser never normalized.
  if (/%(?:2f|5c)/i.test(url.pathname)) return undefined

  const decoded = (() => {
    try {
      return decodeURIComponent(url.pathname)
    } catch {
      return undefined
    }
  })()

  if (
    decoded === undefined ||
    decoded.includes("\0") ||
    decoded.split(/[\\/]/).some((part) => part === "." || part === "..")
  )
    return undefined

  if (
    process.platform === "win32" &&
    !decoded
      .replace(/^\/[a-z]:\//i, "")
      .split("/")
      .every(windowsPreviewSegment)
  )
    return undefined

  return canonicalPath(decoded)
}

/**
 * Whether a file URL points inside one of the allowed directories. The agent already has read
 * access to the session's workspace, so files there may be shown; anything else stays behind the
 * server's file permissions. The roots are filesystem paths, compared as written; a URL whose path cannot be compared
 * with them is outside.
 */
export function fileURLWithin(input: string, roots: ReadonlyArray<string>) {
  const href = localFileURL(input)

  if (!href || roots.length === 0) return false
  const path = filePath(new URL(href))

  if (path === undefined) return false

  return roots.some((root) => {
    const prefix = canonicalPath(root).replace(/\/+$/, "")

    return path === prefix || path.startsWith(`${prefix}/`)
  })
}

/** A page of one of the loaded extensions, such as its popup or options page. */
export function extensionURL(input: string, extensions: ReadonlyArray<string>) {
  if (!URL.canParse(input)) return false
  const url = new URL(input)

  return url.protocol === "chrome-extension:" && extensions.includes(url.hostname)
}

/** Each Chromium permission an extension's page may hold, with the manifest permission that grants it. */
const extensionGrants = [
  ["clipboard-read", "clipboardRead"],
  ["clipboard-sanitized-write", "clipboardWrite"],
  ["notifications", "notifications"],
] as const

/**
 * Whether a page asking from `origin` gets `permission`. A web page gets none. An extension's page (its popup, options
 * page or blob:) gets the clipboard and notifications when the extension's manifest declares them, as Chrome grants
 * them, so a password manager can copy a password; `declared` reads that manifest's permissions by extension ID.
 */
export function pagePermission(permission: string, origin: string, declared: (id: string) => ReadonlyArray<unknown>) {
  if (!URL.canParse(origin)) return false
  const url = new URL(origin)
  const document = url.protocol === "blob:" && URL.canParse(url.pathname) ? new URL(url.pathname) : url
  const needed = extensionGrants.find(([name]) => name === permission)?.[1]

  return (
    document.protocol === "chrome-extension:" && needed !== undefined && declared(document.hostname).includes(needed)
  )
}

/**
 * How long after an agent command what happens in its tab with no user input since still counts as the command's: a
 * download its click started, or a script it ran that acts later, as a timer does.
 */
export const DOWNLOAD_GRACE_MS = 30_000

export type TabActivity = { agentRuns: number; agentEndedAt?: number; userInputAt?: number; agent?: string }

/**
 * Whether the agent drives a tab: the one rule for every "did the agent cause this". Without `now` it is sticky: true
 * from the tab's first agent command, or one inherited from its opener (`childActivity`), until the tab closes; site
 * permissions, clipboard writes and where a prompt puts focus ask this way. With the event's time it is the
 * running-or-recent window: true while an agent command runs, and within `DOWNLOAD_GRACE_MS` after one ended unless the
 * user clicked or typed in the tab since; downloads and opening external apps ask this way (`activityOwner`).
 */
export function agentDriven(activity: Readonly<TabActivity>, now?: number): boolean {
  if (activity.agentRuns > 0) return true

  if (activity.agentEndedAt === undefined) return false

  if (now === undefined) return true

  return (
    now - activity.agentEndedAt <= DOWNLOAD_GRACE_MS &&
    (activity.userInputAt === undefined || activity.userInputAt < activity.agentEndedAt)
  )
}

/** A child inherits provenance, not its opener's in-flight run counter. */
export function childActivity(activity: Readonly<TabActivity>): TabActivity {
  return activity.agentRuns ? { ...activity, agentRuns: 0, agentEndedAt: Date.now() } : { ...activity }
}

/** What a tab's activity was when something happened in it, at `now`. */
export type AgentActivity = {
  readonly now: number
  readonly agentRunning: boolean
  readonly agentEndedAt?: number
  readonly userInputAt?: number
}

/**
 * Whose a download in a tab is. Only one the agent caused (`activityOwner`) is the agent's, and never one where the
 * page or any address it came through is an extension's. Every other download is the user's and takes the system's
 * save flow, which the agent cannot read.
 */
export function downloadOwner(
  download: AgentActivity & { readonly page: ReadonlyArray<string>; readonly chain: ReadonlyArray<string> },
): "agent" | "user" {
  if ([...download.page, ...download.chain].some(Browser.extensionOrigin)) return "user"

  return activityOwner(download)
}

/** Who caused what happened at `now`: `agentDriven` with the event's time, as downloads and external apps ask it. */
export function activityOwner(event: AgentActivity): "agent" | "user" {
  const activity = {
    agentRuns: Number(event.agentRunning),
    agentEndedAt: event.agentEndedAt,
    userInputAt: event.userInputAt,
  }

  return agentDriven(activity, event.now) ? "agent" : "user"
}

/** Actions that only take a tab away from its document, which the agent may run on an extension page to leave it. */
const leaving = ["navigate", "back", "forward", "stop"]

/**
 * Why the agent may not run `action` in a tab whose main frame shows `page`, or undefined when it may. The agent never
 * opens an extension page, and never reads or acts on one, even one the user opened: evaluating there would run with
 * the extension's privileges. The user's own commands do not pass through here.
 */
export function agentRefusal(
  action: { readonly type: string; readonly url?: string },
  page: { readonly url: string; readonly origin: string },
) {
  if (
    (action.type === "navigate" || action.type === "tabs.open") &&
    action.url &&
    Browser.extensionOrigin(action.url.trim())
  )
    return Browser.extensionPageRefusal(action.url.trim())

  if (leaving.includes(action.type) || (!Browser.extensionOrigin(page.url) && !Browser.extensionOrigin(page.origin)))
    return

  return `This tab shows an extension page (${page.url}). Agent browser tools cannot read or act on extension pages, because they run with that extension's privileges. Navigate this tab to a web page, or use another tab.`
}

type FrameTree = {
  readonly frame: {
    readonly id: string
    readonly parentId?: string
    readonly url: string
    readonly name?: string
    readonly securityOrigin?: string
  }
  readonly childFrames?: ReadonlyArray<FrameTree>
}

/** Documents which may receive agent input. Opaque web documents still need an allowed ancestry. */
export function inputDocument(url: string, origin: string) {
  if (Browser.extensionOrigin(origin) || Browser.extensionOrigin(url)) return false

  return /^(?:https?:\/\/|oc-preview:\/\/|file:\/\/|about:(?:blank|srcdoc)(?:[?#]|$)|data:|blob:(?:https?:\/\/|null\/|oc-preview:\/\/))/.test(
    url,
  )
}

type FrameTrees = {
  /** The main frame's tree. */
  readonly root: FrameTree
  /** Each out-of-process frame's tree, under the frame that holds it. */
  readonly children: ReadonlyArray<{ readonly parentID: string; readonly tree: FrameTree }>
  /**
   * Frames excluded by target or context, including every frame in an excluded target's tree.
   */
  readonly extensions: ReadonlySet<string>
}

/** An excluded target contributes only frame IDs, never names, URLs, contexts or agent targets. */
export function excludedFrames(known: Iterable<string>, trees: readonly FrameTree[]) {
  const ids = new Set(known)

  const visit = (tree: FrameTree) => {
    ids.add(tree.frame.id)
    tree.childFrames?.forEach(visit)
  }

  trees.forEach(visit)

  return ids
}

type AgentFrameInfo = { id: string; parentID?: string; url: string; name: string }

/**
 * Every frame the trees name, in one walk, and what the agent may do with a frame ID: use it, or not, because the frame
 * or one of its ancestors shows an extension's document, or because it hangs under no frame the trees name.
 */
function frameIndex(trees: FrameTrees) {
  const frames = new Map<string, { info: AgentFrameInfo; extension: boolean; usable: boolean }>()

  const walk = (tree: FrameTree, parentID?: string) => {
    const parent = tree.frame.parentId || parentID
    const id = tree.frame.id

    if (!frames.has(id))
      frames.set(id, {
        info: parent
          ? { id, parentID: parent, url: tree.frame.url, name: tree.frame.name ?? "" }
          : { id, url: tree.frame.url, name: tree.frame.name ?? "" },
        usable: inputDocument(tree.frame.url, tree.frame.securityOrigin ?? ""),
        extension:
          trees.extensions.has(id) ||
          Browser.extensionOrigin(tree.frame.url) ||
          Browser.extensionOrigin(tree.frame.securityOrigin ?? ""),
      })
    tree.childFrames?.forEach((child) => walk(child, id))
  }

  walk(trees.root)
  trees.children.forEach((child) => walk(child.tree, child.parentID))

  const access = (frameID: string): "frame" | "extension" | "unavailable" => {
    // Bounded by the number of frames, so a malformed tree with a cycle ends too.
    for (let id = frameID, steps = 0; steps <= frames.size; steps++) {
      const entry = frames.get(id)

      if (trees.extensions.has(id) || entry?.extension) return "extension"

      if (!entry?.usable) return "unavailable"

      if (entry.info.parentID === undefined) return "frame"
      id = entry.info.parentID
    }

    return "unavailable"
  }

  return { frames, access }
}

/**
 * The tab's frames the agent may see and target: the main frame's tree, then each out-of-process frame's under its
 * parent. A frame of an extension, such as a password manager's autofill overlay, is left out with every frame inside
 * it, so the page around it stays usable while no frameID, ref or snapshot reaches into it.
 */
export function agentFrames(trees: FrameTrees) {
  const index = frameIndex(trees)

  return Array.from(index.frames.values(), (entry) => entry.info).filter((frame) => index.access(frame.id) === "frame")
}

export type AgentFrameAccess =
  | { type: "frame"; frame: AgentFrameInfo }
  | { type: "extension"; message: string }
  | { type: "unavailable"; message: string }

/**
 * The frame an agent's `frameID` names, when the agent may use it. A frame that shows an extension's document, or
 * sits inside one, is refused by name, so a call never quietly runs elsewhere.
 */
export function agentFrame(trees: FrameTrees, frameID: string): AgentFrameAccess {
  const index = frameIndex(trees)
  const access = index.access(frameID)
  const frame = index.frames.get(frameID)?.info

  if (access === "frame" && frame) return { type: "frame", frame }

  if (access === "extension")
    return {
      type: "extension",
      message: `Agent browser tools cannot use extension frames: frame ${frameID} shows an extension's document, which runs with that extension's privileges. Omit frameID to use the page around it, or use another frame from browser.frames({tabID}).`,
    }

  return {
    type: "unavailable",
    message:
      "Frame is unavailable. Call browser.frames({tabID}) and use a current frameID from this tab; omit frameID for the main frame.",
  }
}

export type Policy = {
  readonly fileRoots?: ReadonlyArray<string>
  readonly extensions?: ReadonlyArray<string>
  readonly home?: string
  readonly remote?: string
  readonly artifacts?: boolean
}

export function allowedDestination(input: string, policy?: Policy) {
  return (
    !!destinationOrigin(input) ||
    fileURLWithin(input, policy?.fileRoots ?? []) ||
    extensionURL(input, policy?.extensions ?? [])
  )
}

export function normalizeURL(input: string, policy?: Policy) {
  const url = withScheme(input, policy)
  const reason = refusal(url, policy)

  if (reason === "browser.address.credentials")
    throw new Error("URLs with a user name or password are not supported. Remove them from the URL.")

  if (reason)
    throw new Error(
      policy?.fileRoots?.length || policy?.remote
        ? "Only HTTP, HTTPS, about:blank, and file URLs inside the workspace are supported."
        : "Only HTTP, HTTPS, and about:blank URLs are supported.",
    )

  return url
}

/** A saved address is evidence for the address bar, not authority to reopen a file after a session move. */
export function restoreRefusal(url: string, policy: Policy) {
  if (!refusal(url, policy)) return

  return /^(?:file|workspace):/i.test(url) ? "browser.restore.outside" : "browser.restore.refused"
}

/**
 * Why the pane does not open an address, as the code the window explains it with; undefined when it opens.
 * - `browser.address.credentials`: a web page address with a user name or password.
 * - `browser.address.workspace`: anything but a web page or a file in the workspace.
 * - `browser.address.web`: anything but a web page, where no files open.
 */
export function refusal(input: string, policy?: Policy) {
  const url = withScheme(input, policy)

  if (
    url === "about:blank" ||
    allowedDestination(url, policy) ||
    (policy?.artifacts && artifactAddress(url)) ||
    (policy?.remote && remotePath(url, policy.remote))
  )
    return

  // A web page is refused only for its credentials.
  if (URL.canParse(url) && /^https?:$/.test(new URL(url).protocol)) return "browser.address.credentials"

  return policy?.fileRoots?.length || policy?.remote ? "browser.address.workspace" : "browser.address.web"
}

// The URL an address opens: a blank page for none, else the address with a scheme, `http` for this machine's names.
export function localAddress(value: string) {
  return /^(?:file:|[a-z]:[\\/]|\\\\|~[\\/]|\.{1,2}[\\/]|\/(?!\/[^/\\]))/i.test(value)
}

function withScheme(input: string, policy?: Policy) {
  const value = input.trim()

  if (!value || /^about:blank$/i.test(value)) return "about:blank"

  if (localAddress(value)) {
    if (/^file:/i.test(value)) return localFileURL(value) ?? value

    // Never resolve a UNC path on the network, even to check whether it exists.
    if (value.startsWith("\\\\")) return value
    const relative = /^(~|\.{1,2})[\\/]/.exec(value)
    const base = relative?.[1] === "~" ? policy?.home : policy?.fileRoots?.[0]

    if (relative && !base) return value
    const path = relative ? `${base}/${relative[1] === "~" ? value.slice(2) : value}` : value

    return new URL(`file://${encodeFilePath(path)}`).href
  }

  if (value.startsWith("//")) return `https:${value}`

  if (/^[a-z][a-z\d+.-]*:\/\//i.test(value)) return value

  return `${Browser.loopbackAddress(value) ? "http" : "https"}://${value}`
}

/**
 * Electron rejects `loadURL` with ERR_FAILED (-2) whenever loading stops before `did-finish-load`. Chromium's media
 * viewer for a video or audio URL commits its document and stops that way, so a committed navigation has loaded. A
 * download never commits, so it still fails.
 */
export function committedLoad(error: Error, committed: boolean) {
  return committed && "errno" in error && error.errno === -2
}
