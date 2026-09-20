export type ExecutionScope = {
  serverKey: string
  ownerDirectory: string
  rootSessionID: string
}

export function createExecutionScope(input: {
  serverKey?: string | null
  ownerDirectory?: string | null
  rootSessionID?: string | null
}): ExecutionScope | undefined {
  if (!input.serverKey?.trim() || !input.ownerDirectory?.trim() || !input.rootSessionID?.trim()) return
  return { serverKey: input.serverKey, ownerDirectory: input.ownerDirectory, rootSessionID: input.rootSessionID }
}

export function scopeKey(scope: ExecutionScope) {
  return JSON.stringify([scope.serverKey, scope.ownerDirectory, scope.rootSessionID])
}

export function runKey(scope: ExecutionScope, runID: string) {
  return JSON.stringify([scope.serverKey, scope.ownerDirectory, scope.rootSessionID, runID])
}
