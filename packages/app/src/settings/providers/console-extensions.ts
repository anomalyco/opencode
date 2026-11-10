import type { ConfigEntry, CredentialEntry, SkillInfo } from "@opencode/client/promise"
import type { ServerConfig } from "@opencode/schema/mcp"
import { Option, Schema } from "effect"

const decodeConsoleMetadata = Schema.decodeUnknownOption(
  Schema.Struct({ server: Schema.optionalKey(Schema.String), orgID: Schema.optionalKey(Schema.String) }),
)

export function consoleAccount(credentials: readonly CredentialEntry[]) {
  const credential = credentials.find((item) => item.integrationID === "opencode" && item.active)

  if (!credential) return

  const metadata = decodeConsoleMetadata(credential.value.metadata ?? {})

  if (Option.isNone(metadata)) return

  return {
    server: (metadata.value.server ?? "https://opencode.ai/console").replace(/\/+$/, ""),
    orgID: metadata.value.orgID,
  }
}

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

export function consoleMcpLinks(item: ConsoleMcp, account: ReturnType<typeof consoleAccount>) {
  if (!account?.orgID || account.server !== item.server) return { manage: item.server }

  const root = `${item.server}/${encodeURIComponent(account.orgID)}/extensions`

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
export function consoleSkillLink(skill: Pick<SkillInfo, "id" | "path">, account: ReturnType<typeof consoleAccount>) {
  if (!account) return

  const slug = /^skill:\/\/([^/]+)\//.exec(skill.path)?.[1]

  if (!slug || ["opencode", "report", "browser"].includes(skill.id)) return

  if (!account.orgID) return account.server

  return `${account.server}/${encodeURIComponent(account.orgID)}/extensions?kind=skills&search=${encodeURIComponent(slug)}`
}

function gateway(config: ServerConfig) {
  if (config.type !== "remote" || config.oauth !== false || !URL.canParse(config.url)) return

  const url = new URL(config.url)

  const match = /^(.*)\/api\/integration-gateway\/([^/]+)\/mcp$/.exec(url.pathname)

  if (!match) return

  return {
    server: `${url.origin}${match[1]}`,
    slug: match[2],
    // Console pins this protocol when it offers tools before the member connects their account.
    needsConnection: config.protocol === "2026-07-28",
  }
}
