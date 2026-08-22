// Sessions whose events this TUI process projects (#37792, stage 1).
// Additive-only for now: the set grows as sessions are opened/hydrated and is
// never pruned. Ref-counted unfollow + persisted tab roots land with the full
// follow registry (stage 2).
const followed = new Set<string>()

export function followSessions(...ids: (string | undefined)[]) {
  for (const id of ids) if (id) followed.add(id)
}

export function isSessionFollowed(sessionID: string): boolean {
  return followed.has(sessionID)
}
