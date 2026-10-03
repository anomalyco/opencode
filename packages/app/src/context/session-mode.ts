export type SessionMode = "complete" | "infinite"

export function resolveSessionMode(value: string | null | undefined): SessionMode {
  if (value === "infinite") return "infinite"
  return "complete"
}

export function cycleSessionMode(current: SessionMode): SessionMode {
  if (current === "infinite") return "complete"
  return "infinite"
}

export function sessionModeInfinite(value: string | null | undefined): boolean {
  return resolveSessionMode(value) === "infinite"
}
