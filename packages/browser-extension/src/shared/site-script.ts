// Site scripts: JavaScript that OpenCode Browser injects into matching pages with chrome.userScripts,
// the API Tampermonkey and Violentmonkey use under Manifest V3. Shared by the background worker,
// the side panel, and (as plain JSON) the opencode plugin that lets agents install them.

export type RunAt = "document_start" | "document_end" | "document_idle"
/** isolated: the user-script world (page DOM, not page JS). page: the page's own JavaScript world. */
export type World = "isolated" | "page"

export type SiteScript = {
  id: string
  name: string
  description?: string
  /** Chrome match patterns, for example `https://x.com/*`. */
  matches: string[]
  excludeMatches?: string[]
  runAt: RunAt
  /** Defaults to isolated. */
  world?: World
  code: string
  enabled: boolean
  created: number
  updated: number
  /** The opencode session that installed it, when an agent did. */
  sessionID?: string
}

/** What an install needs; the rest is filled in from the userscript header or defaults. */
export type SiteScriptDraft = {
  id?: string
  name?: string
  description?: string
  matches?: string[]
  excludeMatches?: string[]
  runAt?: RunAt
  world?: World
  code: string
  sessionID?: string
}

export type SiteScriptsState = {
  /** False until the user turns on "Allow user scripts" for the extension. */
  available: boolean
  error?: string
  scripts: SiteScript[]
}

/** An agent's request to install or replace a script, waiting for the user in the side panel. */
export type SiteScriptApproval = {
  id: string
  script: Required<Pick<SiteScript, "name" | "matches" | "runAt" | "code">> &
    Pick<SiteScript, "description" | "excludeMatches" | "sessionID" | "world">
  /** The installed script this would replace. */
  replaces?: Pick<SiteScript, "id" | "name">
  warnings: string[]
}

const runAts: readonly RunAt[] = ["document_start", "document_end", "document_idle"]

/** Reads a `// ==UserScript==` header. Unsupported keys come back as warnings, not errors. */
export function parseHeader(code: string) {
  const block = code.match(/\/\/\s*==UserScript==([\s\S]*?)\/\/\s*==\/UserScript==/)
  if (!block) return undefined
  const entries = Array.from(block[1].matchAll(/^\s*\/\/\s*@([\w:-]+)(?:[ \t]+(.*?))?\s*$/gm), (match) => ({
    key: match[1],
    value: (match[2] ?? "").trim(),
  }))
  const values = (key: string) => entries.filter((entry) => entry.key === key && entry.value).map((entry) => entry.value)
  const runAt = values("run-at")[0]?.replace(/-/g, "_")
  // Violentmonkey's key for choosing the page world.
  const injectInto = values("inject-into")[0]
  const grants = values("grant").filter((grant) => grant !== "none")
  return {
    name: values("name")[0],
    description: values("description")[0],
    matches: values("match"),
    excludeMatches: values("exclude-match"),
    runAt: runAts.find((item) => item === runAt),
    world: injectInto === "page" ? ("page" as const) : undefined,
    warnings: [
      ...(grants.length ? [`Ignored @grant ${grants.join(", ")}: GM_* APIs are not available.`] : []),
      ...(values("include").length || values("exclude").length
        ? ["Ignored @include/@exclude: use @match and @exclude-match patterns."]
        : []),
      ...(values("require").length ? ["Ignored @require: inline the code instead."] : []),
    ],
  }
}

/** Merges explicit fields with the header; explicit fields win. Throws when nothing says where it runs. */
export function resolveDraft(draft: SiteScriptDraft) {
  const header = parseHeader(draft.code)
  const matches = draft.matches?.length ? draft.matches : (header?.matches ?? [])
  if (!matches.length)
    throw new Error("A site script needs at least one match pattern, for example https://x.com/*.")
  const name = (draft.name || header?.name || hostLabel(matches[0])).slice(0, 200)
  const excludeMatches = draft.excludeMatches?.length ? draft.excludeMatches : header?.excludeMatches
  const description = draft.description || header?.description
  const world = draft.world ?? header?.world
  return {
    script: {
      name,
      matches,
      runAt: draft.runAt ?? header?.runAt ?? "document_idle",
      ...(world === "page" ? { world } : {}),
      code: draft.code,
      ...(description ? { description } : {}),
      ...(excludeMatches?.length ? { excludeMatches } : {}),
      ...(draft.sessionID ? { sessionID: draft.sessionID } : {}),
    },
    warnings: [
      ...(header?.warnings ?? []),
      ...(world === "page"
        ? ["Runs in the page's own JavaScript, so it can read and change the site's code and data, and the site can see it."]
        : []),
    ],
  }
}

/** A readable site label for a match pattern: `https://x.com/*` → `x.com`. */
export function hostLabel(pattern: string) {
  const host = pattern.match(/^[a-z*]+:\/\/([^/]+)/i)?.[1]
  if (!host) return pattern
  return host === "*" ? "all sites" : host.replace(/^\*\./, "")
}

/** Chrome match-pattern semantics: `*` scheme is http(s), `*.host` includes the host, `*` in the path is a glob. */
export function matchesPattern(pattern: string, url: string) {
  if (!URL.canParse(url)) return false
  const target = new URL(url)
  if (pattern === "<all_urls>") return /^(https?|file|ftp|wss?):$/.test(target.protocol)
  const parts = pattern.match(/^(\*|[a-z][a-z0-9+.-]*):\/\/([^/]*)(\/.*)$/i)
  if (!parts) return false
  const scheme = parts[1].toLowerCase()
  const protocol = target.protocol.slice(0, -1)
  if (scheme === "*" ? protocol !== "http" && protocol !== "https" : scheme !== protocol) return false
  const host = parts[2].toLowerCase()
  const hostname = (host.includes(":") ? target.host : target.hostname).toLowerCase()
  const hostMatches =
    host === "*" ||
    host === hostname ||
    (host.startsWith("*.") && (hostname === host.slice(2) || hostname.endsWith(host.slice(1))))
  if (!hostMatches) return false
  const glob = new RegExp(`^${parts[3].split("*").map((piece) => piece.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*")}$`)
  return glob.test(target.pathname + target.search)
}

/** Whether a script applies to a URL: any match pattern and no exclusion. */
export function appliesTo(script: Pick<SiteScript, "matches" | "excludeMatches">, url: string) {
  return (
    script.matches.some((pattern) => matchesPattern(pattern, url)) &&
    !(script.excludeMatches ?? []).some((pattern) => matchesPattern(pattern, url))
  )
}
