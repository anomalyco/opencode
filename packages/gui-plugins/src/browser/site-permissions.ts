// Which device and browser features a web page gets, and the decisions the user kept. Electron-free: the session
// guard and each page's prompt driver call these, and the settings page lists the decisions through `BrowserSites`.
import { Schema } from "effect"
import { Ipc } from "@opencode/plugin/gui"
import type { Storage } from "@opencode/plugin/gui/main"
import { previewScheme } from "./scheme"

/** The features a page may ask the user for. Every other permission stays denied without asking. */
export const PermissionKinds = ["camera", "microphone", "location", "notifications", "clipboard-read"] as const

export type PermissionKind = (typeof PermissionKinds)[number]

const SiteDecision = Schema.Struct({
  /** The site's origin, as `new URL(...).origin` writes it. */
  origin: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(2_048)),
  permission: Schema.Literals(PermissionKinds),
  setting: Schema.Literals(["allow", "block"]),
})

export type SiteDecision = typeof SiteDecision.Type

const SiteDecisions = Schema.Array(SiteDecision)

/**
 * The decisions the user kept for sites, in Settings › Browser. A decision applies to the page whose top-level document
 * has its origin, in every tab, session and server of this desktop; a local preview's decisions are never kept.
 */
export const BrowserSites = Ipc.define({
  id: "browser.sites",
  state: Schema.Struct({ decisions: SiteDecisions }),
  methods: {
    /** Changes a kept decision; a decision that is not kept is not added. */
    set: { input: SiteDecision },
    /** Forgets a kept decision, so the site asks again. */
    remove: { input: Schema.Struct({ origin: SiteDecision.fields.origin, permission: SiteDecision.fields.permission }) },
  },
})

/** The features a Chromium permission asks for, or none: a permission no web page gets, such as USB or MIDI sysex. */
export function permissionKinds(permission: string, media: readonly string[] = []): readonly PermissionKind[] {
  if (permission === "media")
    return [
      ...(media.includes("video") ? ["camera" as const] : []),
      ...(media.includes("audio") ? ["microphone" as const] : []),
    ]

  if (permission === "geolocation") return ["location"]

  if (permission === "notifications") return ["notifications"]

  if (permission === "clipboard-read") return ["clipboard-read"]

  return []
}

/**
 * Whether an origin is a secure context, which these features need: HTTPS, a local preview, or this machine's own
 * names over HTTP, as Chromium counts them.
 */
export function trustworthy(origin: string) {
  if (!URL.canParse(origin)) return false
  const url = new URL(origin)

  if (url.protocol === "https:" || url.protocol === `${previewScheme}:`) return true

  if (url.protocol !== "http:") return false

  return (
    url.hostname === "localhost" ||
    url.hostname.endsWith(".localhost") ||
    url.hostname === "[::1]" ||
    /^127(?:\.\d{1,3}){3}$/.test(url.hostname)
  )
}

/**
 * The origin Chromium gives a document at `url`, without a trailing slash. The URL parser gives a local preview's
 * scheme no origin, but Chromium registers it as a standard scheme, whose origin is its scheme and host.
 */
export function originOf(url: string) {
  if (!URL.canParse(url)) return "null"
  const parsed = new URL(url)

  if (parsed.origin !== "null") return parsed.origin

  return parsed.protocol === `${previewScheme}:` && parsed.host ? `${parsed.protocol}//${parsed.host}` : "null"
}

/** A local preview's origin is new for each attachment, so a decision for it is never kept. */
export function previewOrigin(origin: string) {
  return origin.toLowerCase().startsWith(`${previewScheme}:`)
}

export type SiteRequest = {
  /** The requesting frame's origin. */
  readonly origin: string
  /** The tab's top-level origin. */
  readonly top: string
  readonly mainFrame: boolean
  readonly kinds: readonly PermissionKind[]
}

/**
 * What a page's request gets before anyone is asked: `block` for a feature no page gets, an insecure origin, an
 * embedded page of another origin (Chrome would let one through only by permissions policy, which this does not
 * read), or a decision to block; `allow` when each feature is allowed; else `ask`. `decided` reads this visit's
 * decision, then the kept one.
 */
export function siteAnswer(request: SiteRequest, decided: (kind: PermissionKind) => "allow" | "block" | undefined) {
  if (!request.kinds.length || !sameSite(request) || !trustworthy(request.origin)) return "block" as const
  const decisions = request.kinds.map(decided)

  if (decisions.includes("block")) return "block" as const

  return decisions.every((decision) => decision === "allow") ? ("allow" as const) : ("ask" as const)
}

/**
 * Clipboard writes follow Chrome, which lets a secure page write without asking, here only while no agent command
 * runs in the tab, so the agent never fills the user's clipboard through a page.
 */
export function clipboardWrite(request: Omit<SiteRequest, "kinds">, agentRunning: boolean) {
  return !agentRunning && sameSite(request) && trustworthy(request.origin)
}

/**
 * Whether the user may keep a decision for the origin: never for a local preview, and not for a remote server's own
 * machine (`localhost` there is another computer than this desktop's).
 */
export function rememberable(origin: string, remote: boolean) {
  if (previewOrigin(origin)) return false

  return !(remote && trustworthy(origin) && new URL(origin).protocol === "http:")
}

/** The kept decisions, in main. Each change is written at once and reported to `changed`. */
export function createSitePermissions(storage: Storage, changed: () => void) {
  const stored = storage.store("site-permissions", { schema: SiteDecisions, initial: [] })

  const write = (next: readonly SiteDecision[]) => {
    stored.set(next)
    changed()
  }

  return {
    list: () => stored.value,
    get: (origin: string, permission: PermissionKind) =>
      stored.value.find((item) => item.origin === origin && item.permission === permission)?.setting,
    /** Keeps a decision, replacing the origin's earlier one for that feature. */
    keep: (decision: SiteDecision) => {
      if (previewOrigin(decision.origin)) return
      write([...stored.value.filter((item) => !same(item, decision)), decision])
    },
    /** Changes a kept decision only. */
    set: (decision: SiteDecision) => {
      if (stored.value.some((item) => same(item, decision)))
        write(stored.value.map((item) => (same(item, decision) ? decision : item)))
    },
    remove: (decision: Pick<SiteDecision, "origin" | "permission">) =>
      write(stored.value.filter((item) => !same(item, decision))),
  }
}

export type SitePermissions = ReturnType<typeof createSitePermissions>

function sameSite(request: Omit<SiteRequest, "kinds">) {
  return request.origin !== "null" && (request.mainFrame || request.origin === request.top)
}

function same(a: Pick<SiteDecision, "origin" | "permission">, b: Pick<SiteDecision, "origin" | "permission">) {
  return a.origin === b.origin && a.permission === b.permission
}
