import type { SessionInfo } from "@opencode/client/promise"

/** Merge live metadata into indexed roots. Only a completed run advances an indexed row's recency. */
export function mergeRootSessionIndex(indexed: readonly SessionInfo[], known: readonly SessionInfo[]) {
  const rows = new Map(indexed.map((info) => [info.id, info]))

  for (const info of known) {
    const time = rows.get(info.id)?.time
    const passive = time && (info.time.idle ?? 0) <= (time.idle ?? 0) && info.time.updated !== time.updated
    rows.set(info.id, passive ? { ...info, time: { ...info.time, updated: time.updated } } : info)
  }

  return [...rows.values()].filter((info) => !info.parentID)
}
