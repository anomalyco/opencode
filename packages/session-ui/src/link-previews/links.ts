import { Marked, type Token } from "marked"
import { Schema } from "effect"

export type GitHubKind = "repository" | "issue" | "pull" | "commit"

export type GitHubState = "open" | "closed" | "merged" | "draft" | "completed" | "notPlanned"

/** A public link a finished reply names, normalised; `url` is its cache key and what a click opens. */
export type LinkTarget =
  | { type: "github"; url: string; repository: string; kind: GitHubKind; reference?: string }
  | { type: "web"; url: string; host: string; title?: string }

export type GitHubTarget = Extract<LinkTarget, { type: "github" }>

/** What GitHub's REST API says about a link. */
export type GitHubPreview = {
  title: string
  state?: GitHubState
  additions?: number
  deletions?: number
  stars?: number
  language?: string
}

const lexer = new Marked()

/**
 * The previewable links a reply names, in reading order and once each: Markdown links and the bare URLs GFM
 * autolinks. Code spans and code blocks are code, not links, and private or credential-bearing links never preview.
 */
export function replyLinks(text: string, limit = 6) {
  const hrefs: string[] = []

  lexer.walkTokens(lexer.lexer(text), (token: Token) => {
    if (token.type === "link") hrefs.push(token.href)
  })

  const seen = new Set<string>()

  return hrefs
    .flatMap((href) => {
      const target = linkTarget(href)

      if (!target || seen.has(target.url)) return []
      seen.add(target.url)

      return [target]
    })
    .slice(0, limit)
}

export function linkTarget(href: string): LinkTarget | undefined {
  const url = publicURL(href)

  if (!url) return undefined
  normalize(url)

  return githubTarget(url) ?? { type: "web", url: url.href, host: displayHost(url), title: readableTitle(url) }
}

/** What a GitHub link's URL alone says: `acme/widget #1251`, `acme/widget · a1b2c3d`, or the repository. */
export function githubCaption(link: GitHubTarget) {
  if (!link.reference) return link.repository

  if (link.kind === "commit") return `${link.repository} · ${link.reference.slice(0, 7)}`

  return `${link.repository} #${link.reference}`
}

/**
 * The REST endpoint for a GitHub link, built from its checked identifiers alone. A commit asks for one file: its
 * `stats` still total the whole diff, and the answer stays small however many files it touched.
 */
export function githubRequestURL(link: GitHubTarget) {
  const path = { repository: "", issue: "/issues/", pull: "/pulls/", commit: "/commits/" }[link.kind]
  const query = link.kind === "commit" ? "?per_page=1" : ""

  return `https://api.github.com/repos/${link.repository}${path}${link.reference ?? ""}${query}`
}

const nullable = <S extends Schema.Top>(schema: S) => Schema.optional(Schema.NullOr(schema))

const GitHubResponse = Schema.Struct({
  title: nullable(Schema.String),
  full_name: nullable(Schema.String),
  state: nullable(Schema.String),
  state_reason: nullable(Schema.String),
  merged: nullable(Schema.Boolean),
  draft: nullable(Schema.Boolean),
  additions: nullable(Schema.Number),
  deletions: nullable(Schema.Number),
  stargazers_count: nullable(Schema.Number),
  language: nullable(Schema.String),
  stats: nullable(Schema.Struct({ additions: nullable(Schema.Number), deletions: nullable(Schema.Number) })),
  commit: nullable(Schema.Struct({ message: Schema.String })),
})

export type GitHubResponse = typeof GitHubResponse.Type

/** The fields a preview reads from a GitHub REST response body. */
export const decodeGitHubResponse = Schema.decodeUnknownOption(GitHubResponse)

/** A GitHub REST response as a preview; undefined when it lacks the title the row needs. */
export function githubPreviewOf(link: GitHubTarget, value: GitHubResponse): GitHubPreview | undefined {
  const title = {
    repository: value.full_name,
    issue: value.title,
    pull: value.title,
    commit: value.commit?.message.split("\n")[0],
  }[link.kind]?.trim()

  if (!title) return undefined

  return {
    title: title.slice(0, 300),
    state: githubState(link.kind, value),
    additions: value.additions ?? value.stats?.additions ?? undefined,
    deletions: value.deletions ?? value.stats?.deletions ?? undefined,
    stars: value.stargazers_count ?? undefined,
    language: value.language ?? undefined,
  }
}

function githubState(
  kind: GitHubKind,
  value: { state?: string | null; state_reason?: string | null; merged?: boolean | null; draft?: boolean | null },
): GitHubState | undefined {
  if (kind === "issue") {
    if (value.state === "open") return "open"

    if (value.state === "closed") return value.state_reason === "not_planned" ? "notPlanned" : "completed"

    return undefined
  }

  if (kind !== "pull") return undefined

  if (value.merged) return "merged"

  if (value.state === "closed") return "closed"

  if (value.draft) return "draft"

  if (value.state === "open") return "open"

  return undefined
}

// Public web pages only: never loopback, private or tailnet hosts, IP literals, custom ports, embedded credentials,
// or URLs whose query carries a token or signature.
function publicURL(href: string) {
  if (!URL.canParse(href)) return undefined

  const url = new URL(href)

  if (url.protocol !== "https:" && url.protocol !== "http:") return undefined

  if (url.username || url.password) return undefined

  if (url.port && url.port !== "80" && url.port !== "443") return undefined

  const host = url.hostname.replace(/^\.+|\.+$/g, "")

  if (!host || host.startsWith("[") || host.includes(":")) return undefined

  if (host.split(".").every((label) => /^\d+$/.test(label))) return undefined
  // A single label (`intranet`, `nas`) is a local name.

  if (!host.includes(".")) return undefined

  if (privateSuffixes.some((suffix) => host === suffix.slice(1) || host.endsWith(suffix))) return undefined

  if ([...url.searchParams.keys()].some(credential)) return undefined

  return url
}

const privateSuffixes = [
  ".localhost",
  ".local",
  ".internal",
  ".intranet",
  ".lan",
  ".home",
  ".corp",
  ".home.arpa",
  ".test",
  ".invalid",
  ".example",
  ".ts.net",
  ".onion",
]

const credentialNames = new Set([
  "key",
  "apikey",
  "api_key",
  "auth",
  "authorization",
  "code",
  "sig",
  "sid",
  "session",
  "sessionid",
  "jwt",
  "otp",
  "ticket",
  "pass",
  "pwd",
  "credential",
  "credentials",
  "x-amz-credential",
  "x-goog-credential",
])

function credential(name: string) {
  const lower = name.toLowerCase()

  return credentialNames.has(lower) || ["token", "signature", "secret", "password"].some((part) => lower.includes(part))
}

const trackingParameters = new Set([
  "fbclid",
  "gclid",
  "dclid",
  "igshid",
  "mc_cid",
  "mc_eid",
  "ref_src",
  "ref_url",
  "si",
])

// One link per page: no fragment, trailing slash, or tracking parameters.
function normalize(url: URL) {
  url.hostname = url.hostname.replace(/\.+$/, "")
  url.hash = ""
  ;[...url.searchParams.keys()]
    .filter((name) => name.toLowerCase().startsWith("utm_") || trackingParameters.has(name.toLowerCase()))
    .forEach((name) => url.searchParams.delete(name))

  if (url.pathname.length > 1 && url.pathname.endsWith("/")) url.pathname = url.pathname.replace(/\/+$/, "")
}

function displayHost(url: URL) {
  return url.hostname.replace(/^www\./, "")
}

const reservedOwners = new Set([
  "about",
  "codespaces",
  "collections",
  "customer-stories",
  "discussions",
  "enterprise",
  "events",
  "explore",
  "features",
  "issues",
  "login",
  "marketplace",
  "new",
  "notifications",
  "orgs",
  "organizations",
  "pricing",
  "pulls",
  "readme",
  "search",
  "security",
  "settings",
  "signup",
  "site",
  "sponsors",
  "team",
  "topics",
  "trending",
  "users",
])

// `/<owner>/<repo>`, `/<owner>/<repo>/issues/<n>`, `/<owner>/<repo>/pull/<n>` or `/<owner>/<repo>/commit/<sha>`.
function githubTarget(url: URL): GitHubTarget | undefined {
  if (url.hostname !== "github.com" || url.pathname.includes("%")) return undefined

  const parts = url.pathname.split("/").slice(1)

  if (parts.length !== 2 && parts.length !== 4) return undefined

  const owner = parts[0]!
  const name = parts[1]!

  if (!/^[A-Za-z0-9-]{1,39}$/.test(owner) || reservedOwners.has(owner.toLowerCase())) return undefined

  if (!/^[A-Za-z0-9_.-]{1,100}$/.test(name) || name === "." || name === "..") return undefined

  const repository = `${owner}/${name}`

  if (parts.length === 2) return { type: "github", url: url.href, repository, kind: "repository" }

  const section = parts[2]
  const reference = parts[3]!

  if ((section === "issues" || section === "pull") && /^[1-9]\d{0,9}$/.test(reference))
    return { type: "github", url: url.href, repository, kind: section === "pull" ? "pull" : "issue", reference }

  if (section === "commit" && /^[0-9a-fA-F]{7,40}$/.test(reference))
    return { type: "github", url: url.href, repository, kind: "commit", reference }

  return undefined
}

/**
 * A link without metadata, named from its path: `/guides/background-transfers` reads "Background transfers",
 * `/incidents/42` "Incidents 42", and an index page its folder. Undefined when the path names nothing readable,
 * such as a hash or an ID.
 */
export function readableTitle(url: URL) {
  const parts = url.pathname
    .split("/")
    .filter(Boolean)
    .map((part) => words(safeDecode(part)))

  while (parts.length > 0 && ["index", "readme", ""].includes(parts.at(-1)!.toLowerCase())) parts.pop()

  const last = parts.at(-1)

  if (!last) return undefined

  const title = /^\d+$/.test(last) && parts.length > 1 ? `${parts.at(-2)} ${last}`.trim() : last
  const letters = [...title].filter((char) => /\p{L}/u.test(char)).length
  const ideographic = /\p{Ideographic}/u.test(title)
  // A single token mixing letters and digits is a hash or an ID, not a name.
  const token = !title.includes(" ") && /\d/.test(title)

  if (letters < (ideographic ? 1 : 3) || title.length > 80 || token) return undefined

  return title.charAt(0).toUpperCase() + title.slice(1)
}

function words(part: string) {
  return part
    .replace(/\.(html?|php|aspx?|md)$/i, "")
    .replace(/[-_+.]+/g, " ")
    .trim()
}

function safeDecode(part: string) {
  if (!/%[0-9a-fA-F]{2}/.test(part)) return part

  try {
    return decodeURIComponent(part)
  } catch {
    return part
  }
}
