export type PtyStatus = "running" | "exited"

export type PtyInfo = {
  id: string
  title: string
  command: string
  args: string[]
  cwd: string
  status: PtyStatus
  pid: number
}

export type CreateInput = {
  command?: string
  args?: string[]
  cwd?: string
  title?: string
  env?: Record<string, string>
}

export type CreateContext = {
  sessionId?: string
  requestId?: string
}

export type CreateLocal = (input: CreateInput, requestId?: string) => Promise<PtyInfo>
export type CreateViaBroker = (input: CreateInput, sessionId: string, requestId?: string) => Promise<PtyInfo>

export type TerminalDeps = {
  isAuthEnabled: () => boolean
  createLocal: CreateLocal
  createViaBroker: CreateViaBroker
}

export async function createTerminal(input: CreateInput, context: CreateContext, deps: TerminalDeps): Promise<PtyInfo> {
  if (context.sessionId && deps.isAuthEnabled()) {
    return deps.createViaBroker(input, context.sessionId, context.requestId)
  }
  return deps.createLocal(input, context.requestId)
}
