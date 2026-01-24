const contextStore = new Map<string, string>()

function makeKey(sessionId: string, domain: string): string {
  return `${sessionId}:${domain}`
}

export function getContextId(sessionId: string, domain: string): string | undefined {
  return contextStore.get(makeKey(sessionId, domain))
}

export function setContextId(sessionId: string, domain: string, contextId: string): void {
  contextStore.set(makeKey(sessionId, domain), contextId)
}

export function clearContextId(sessionId: string, domain: string): void {
  contextStore.delete(makeKey(sessionId, domain))
}

export function clearAllContexts(): void {
  contextStore.clear()
}
