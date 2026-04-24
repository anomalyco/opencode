export const OPENCODE_RUN_ID = "OPENCODE_RUN_ID"
export const OPENCODE_PROCESS_ROLE = "OPENCODE_PROCESS_ROLE"

const PROCESS_START_TIME = Date.now()

export function processStartTime() {
  return PROCESS_START_TIME
}

export function ensureRunID() {
  return (process.env[OPENCODE_RUN_ID] ??= crypto.randomUUID())
}

export function ensureProcessRole(fallback: "main" | "worker") {
  return (process.env[OPENCODE_PROCESS_ROLE] ??= fallback)
}

export function ensureProcessMetadata(fallback: "main" | "worker") {
  return {
    runID: ensureRunID(),
    processRole: ensureProcessRole(fallback),
    startTime: PROCESS_START_TIME,
  }
}

export function sanitizedProcessEnv(overrides?: Record<string, string>) {
  const env = Object.fromEntries(
    Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined),
  )
  return overrides ? Object.assign(env, overrides) : env
}
