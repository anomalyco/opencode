import type { ConfigEntry, SkillInfo } from "@opencode/client/promise"
import type { ServerConfig } from "@opencode/schema/mcp"
import { Option, Result, Schema } from "effect"
import { Base64Url } from "effect/encoding"

const CONSOLE_URL = "https://opencode.ai/console"

const decodeGatewayClaims = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Struct({ w: Schema.String })))

/** Config exposes no source field, so recognize only Console's managed gateway entries. */
export function consoleMcps(entries: readonly ConfigEntry[], active: readonly ConfigEntry[] = entries) {
  const offered = new Map<string, NonNullable<ReturnType<typeof gateway>>>()

  entries.forEach((entry) => {
    if (entry.type !== "document") return
    Object.entries(entry.info.mcp?.servers ?? {}).forEach(([name, config]) => {
      const source = gateway(config)

      if (source) offered.set(name, source)
    })
  })

  const effective = new Map(
    active.flatMap((entry) => (entry.type === "document" ? Object.entries(entry.info.mcp?.servers ?? {}) : [])),
  )

  return [...offered]
    .toSorted(([a], [b]) => a.localeCompare(b))
    .map(([name, source]) => {
      const current = effective.get(name)

      const owner = current && gateway(current)

      return { name, ...source, overridden: owner?.server !== source.server || owner?.slug !== source.slug }
    })
}

export type ConsoleMcp = ReturnType<typeof consoleMcps>[number]

/** The Console and workspace the gateway servers belong to; every server Console delivers names the same one. */
export function consoleWorkspace(mcps: readonly ConsoleMcp[]) {
  const source = mcps.find((item) => item.workspace)

  return source?.workspace ? { server: source.server, workspace: source.workspace } : undefined
}

export function consoleMcpLinks(item: ConsoleMcp) {
  if (!item.workspace) return { manage: item.server, connect: item.server }

  const root = `${item.server}/${encodeURIComponent(item.workspace)}/extensions`

  return {
    manage: `${root}/mcp/${encodeURIComponent(item.slug)}`,
    connect: `${root}?connect=${encodeURIComponent(item.slug)}`,
  }
}

/**
 * Where a Console skill is managed. Skills have no source field yet, so a virtual `skill://` skill counts as Console's
 * while Console is signed in, except the ones OpenCode ships. The page of one skill needs Console's internal ID, which
 * the app doesn't receive, so the link opens Console's skills filtered to this one.
 */
export function consoleSkillLink(
  skill: Pick<SkillInfo, "id" | "path">,
  workspace: ReturnType<typeof consoleWorkspace>,
  signedIn: boolean,
) {
  if (!signedIn) return

  const slug = /^skill:\/\/([^/]+)\//.exec(skill.path)?.[1]

  if (!slug || ["opencode", "report", "browser"].includes(skill.id)) return

  if (!workspace) return CONSOLE_URL

  return `${workspace.server}/${encodeURIComponent(workspace.workspace)}/extensions?kind=skills&search=${encodeURIComponent(slug)}`
}

function gateway(config: ServerConfig) {
  if (config.type !== "remote" || config.oauth !== false || !URL.canParse(config.url)) return

  const url = new URL(config.url)

  const match = /^(.*)\/api\/integration-gateway\/([^/]+)\/mcp$/.exec(url.pathname)

  if (!match) return

  return {
    server: `${url.origin}${match[1]}`,
    slug: match[2],
    workspace: gatewayWorkspace(config.headers),
    // Console pins this protocol when it offers tools before the member connects their account.
    needsConnection: config.protocol === "2026-07-28",
  }
}

// Console's gateway token is `ocgw_<base64url claims>.<signature>`, and its claims name the workspace (`w`).
function gatewayWorkspace(headers: Readonly<Record<string, string>> | undefined) {
  const authorization = Object.entries(headers ?? {}).find(([name]) => name.toLowerCase() === "authorization")?.[1]

  const claims = /^Bearer ocgw_([^.]+)\./.exec(authorization ?? "")?.[1]

  if (!claims) return

  const decoded = Result.getOrUndefined(Base64Url.decodeString(claims))

  if (decoded === undefined) return

  return Option.getOrUndefined(decodeGatewayClaims(decoded))?.w
}
