import type { Plugin } from "./index"

type FileLock = Readonly<{
  sessionId: string
  timestamp: number
  agentId?: string
}>

// Use immutable operations with eslint ignore for necessary mutations
const globalLocks = new Map<string, FileLock>()
const sessionFilePaths = new Map<string, string>()

// Path utilities
function normalizePath(filePath: string): string {
  return filePath.replace(/\\/g, "/").normalize()
}

// Lock creation and management
function createLock(sessionId: string, agentId?: string): FileLock {
  return {
    sessionId,
    timestamp: Date.now(),
    agentId,
  }
}

function addLock(filePath: string, lock: FileLock): void {
  const normalizedPath = normalizePath(filePath)
  // eslint-disable-next-line functional/immutable-data
  globalLocks.set(normalizedPath, lock)
}

function removeLock(filePath: string): void {
  const normalizedPath = normalizePath(filePath)
  // eslint-disable-next-line functional/immutable-data
  globalLocks.delete(normalizedPath)
}

// Lock operations
function acquireLock(filePath: string, sessionId: string, agentId?: string): boolean {
  const normalizedPath = normalizePath(filePath)
  const existingLock = globalLocks.get(normalizedPath)

  if (existingLock && existingLock.sessionId !== sessionId) {
    return false
  }

  const newLock = createLock(sessionId, agentId)
  addLock(normalizedPath, newLock)
  return true
}

function releaseLock(filePath: string, sessionId: string): void {
  const normalizedPath = normalizePath(filePath)
  const existingLock = globalLocks.get(normalizedPath)

  if (existingLock && existingLock.sessionId === sessionId) {
    removeLock(normalizedPath)
  }
}

function isLocked(filePath: string, sessionId: string): boolean {
  const normalizedPath = normalizePath(filePath)
  const existingLock = globalLocks.get(normalizedPath)

  return existingLock !== undefined && existingLock.sessionId !== sessionId
}

function getLockInfo(filePath: string): FileLock | undefined {
  const normalizedPath = normalizePath(filePath)
  return globalLocks.get(normalizedPath)
}

// Lock expiration
function isLockExpired(lock: FileLock, timeoutMs: number): boolean {
  return Date.now() - lock.timestamp > timeoutMs
}

function getExpiredPaths(): readonly string[] {
  const lockTimeout = 5 * 60 * 1000 // 5 minutes
  return Array.from(globalLocks.entries())
    .filter(([, lock]) => isLockExpired(lock, lockTimeout))
    .map(([path]) => path)
}

function cleanupExpiredLocks(): void {
  const expiredPaths = getExpiredPaths()
  expiredPaths.forEach(removeLock)
}

// Tool detection
function getFilePathFromArgs(args: Record<string, unknown>): string | null {
  const filePathCandidates = ["filePath", "relative_path"]

  for (const candidate of filePathCandidates) {
    const value = args[candidate]
    if (typeof value === "string") {
      return value
    }
  }

  return null
}

function isFileOperationTool(toolName: string): boolean {
  const fileTools = [
    "write",
    "edit",
    "read",
    "serena_create_text_file",
    "serena_replace_regex",
    "serena_replace_symbol_body",
    "serena_insert_before_symbol",
    "serena_insert_after_symbol",
  ]

  return fileTools.includes(toolName)
}

// Formatting utilities
function formatLockInfo(path: string, lock: FileLock): string {
  const sessionShort = lock.sessionId.substring(0, 8)
  const agent = lock.agentId || "unknown"
  return `${path} (session: ${sessionShort}..., agent: ${agent})`
}

function calculateTimeRemaining(lockTimestamp: number): number {
  const lockTimeout = 5 * 60 * 1000 // 5 minutes
  return Math.max(0, lockTimeout - (Date.now() - lockTimestamp))
}

function formatTimeRemaining(ms: number): string {
  const minutes = Math.ceil(ms / (60 * 1000))
  return `${minutes} minutes`
}

function createLockErrorMessage(filePath: string, lockInfo: FileLock): string {
  const sessionShort = lockInfo.sessionId.substring(0, 8)
  const agent = lockInfo.agentId || "unknown"
  const timeRemaining = calculateTimeRemaining(lockInfo.timestamp)
  const timeFormatted = formatTimeRemaining(timeRemaining)

  return (
    `File ${filePath} is locked by another agent (session: ${sessionShort}..., agent: ${agent}). ` +
    `Lock expires in ${timeFormatted}.`
  )
}

// Hook implementations
function createBeforeHook(sessionId: string) {
  return async (input: { tool: string; sessionID: string; callID: string }, output: { args: unknown }) => {
    if (!isFileOperationTool(input.tool)) return

    const filePath = getFilePathFromArgs(output.args as Record<string, unknown>)
    if (!filePath) return

    // Store file path for this session/tool combination
    // eslint-disable-next-line functional/immutable-data
    sessionFilePaths.set(`${sessionId}:${input.tool}:${input.callID}`, filePath)

    cleanupExpiredLocks()

    if (isLocked(filePath, sessionId)) {
      const lockInfo = getLockInfo(filePath)
      if (lockInfo) {
        throw new Error(createLockErrorMessage(filePath, lockInfo))
      }
    }

    if (!acquireLock(filePath, sessionId)) {
      throw new Error(`Failed to acquire lock for file: ${filePath}`)
    }
  }
}

function createAfterHook(sessionId: string) {
  return async (input: { tool: string; sessionID: string; callID: string }) => {
    if (!isFileOperationTool(input.tool)) return

    // Get the file path that was stored in the before hook
    const sessionKey = `${sessionId}:${input.tool}:${input.callID}`
    const filePath = sessionFilePaths.get(sessionKey)

    if (filePath) {
      releaseLock(filePath, sessionId)
      // eslint-disable-next-line functional/immutable-data
      sessionFilePaths.delete(sessionKey)
    }
  }
}

function createSessionEndHook(sessionId: string) {
  return async () => {
    const sessionLocks = Array.from(globalLocks.entries())
      .filter(([, lock]) => lock.sessionId === sessionId)
      .map(([path]) => path)

    sessionLocks.forEach((path) => releaseLock(path, sessionId))

    // Clean up session file paths
    const keysToDelete = Array.from(sessionFilePaths.keys()).filter((key) => key.startsWith(`${sessionId}:`))
    keysToDelete.forEach((key) => {
      // eslint-disable-next-line functional/immutable-data
      sessionFilePaths.delete(key)
    })
  }
}

// Main plugin
export const FileLockPlugin: Plugin = async (input) => {
  const sessionId = Math.random().toString(36).substring(7)

  return {
    "tool.execute.before": createBeforeHook(sessionId),
    "tool.execute.after": createAfterHook(sessionId),
    "session.end": createSessionEndHook(sessionId),
  }
}
