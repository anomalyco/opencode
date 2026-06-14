// Client-side session-hierarchy helpers for the nested-agent UI (Phase 2,
// Issue 4). The TUI only ever holds a flat `sync.data.session` array, so depth
// and breadcrumb context are derived from the `parentID` chain — the same
// lineage-walk the server uses (`Session.lineage`), no extra wire fields
// required. The functions stay pure over a minimal `{ id, parentID, title }`
// shape so they unit-test without the full SDK `Session` type and without a
// renderer.

export interface LineageSession {
  id: string
  parentID?: string
  title?: string
}

/**
 * Walk the `parentID` chain from the root down to `sessionID` and return the
 * sessions in root→leaf order. A dangling parent link truncates the walk; a
 * parent cycle terminates instead of looping forever; an unknown start session
 * yields an empty array. Never throws — a UI helper must not crash a render.
 */
export function sessionLineage<S extends LineageSession>(sessions: readonly S[], sessionID: string): S[] {
  const byID = new Map<string, S>()
  for (const session of sessions) byID.set(session.id, session)

  const chain: S[] = []
  const seen = new Set<string>()
  let current = byID.get(sessionID)
  while (current && !seen.has(current.id)) {
    seen.add(current.id)
    chain.push(current)
    current = current.parentID ? byID.get(current.parentID) : undefined
  }
  return chain.reverse()
}

/**
 * Nesting depth of `sessionID` derived from the parent chain: root = 1, its
 * child = 2, and so on. An unknown session is depth 0 (renders no badge).
 */
export function sessionDepth(sessions: readonly LineageSession[], sessionID: string): number {
  return sessionLineage(sessions, sessionID).length
}

/** Title chain root→leaf for a breadcrumb header. */
export function sessionBreadcrumb(sessions: readonly LineageSession[], sessionID: string): string[] {
  return sessionLineage(sessions, sessionID).map((s) => s.title ?? "")
}

/**
 * Compact depth badge for a subagent task card. Only nested sessions
 * (depth ≥ 2) carry a badge; the root level and invalid depths render nothing.
 */
export function formatDepthBadge(depth: number | undefined): string {
  if (typeof depth !== "number" || !Number.isFinite(depth) || depth < 2) return ""
  return `L${depth}`
}

/**
 * Prefix a subagent task-card label with its depth badge when the spawned
 * child is nested below the top level (depth ≥ 2). At the root level — or when
 * the depth is unknown — the label is returned unchanged.
 */
export function formatSubagentLabel(label: string, depth: number | undefined): string {
  const badge = formatDepthBadge(depth)
  return badge ? `${badge} ${label}` : label
}

/**
 * Render the "asked by @agent (depth N)" attribution for a routed permission
 * ask from its `metadata` (`originSessionID`/`originAgent`/`originDepth`, set in
 * `session/tools.ts` whenever an ask is routed away from the asking session).
 * Returns `undefined` when the ask did not originate elsewhere or the origin
 * fields are absent/malformed — callers `<Show>` on the result.
 */
export function formatOriginAttribution(metadata: Record<string, unknown> | undefined): string | undefined {
  if (!metadata) return undefined

  const originSessionID = metadata["originSessionID"]
  if (typeof originSessionID !== "string" || originSessionID.length === 0) return undefined

  const rawAgent = metadata["originAgent"]
  const agent = typeof rawAgent === "string" && rawAgent.length > 0 ? `@${rawAgent}` : "a subagent"

  const rawDepth = metadata["originDepth"]
  const depth = typeof rawDepth === "number" && Number.isFinite(rawDepth) ? rawDepth : undefined

  return depth !== undefined ? `asked by ${agent} (depth ${depth})` : `asked by ${agent}`
}
