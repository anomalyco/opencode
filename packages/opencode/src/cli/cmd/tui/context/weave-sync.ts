export type WeaveState = {
  sessionID: string
  version: number
  snapshots: unknown[]
  summaryNodes: unknown[]
  episodes: unknown[]
  dispatches: unknown[]
  messageLinks: unknown[]
  updatedAt: number
}

type WeaveClient = {
  session?: {
    weave?: (args: { sessionID: string }) => Promise<{ data?: WeaveState }>
  }
}

export function getWeaveMethod(client: unknown) {
  return (client as WeaveClient | undefined)?.session?.weave
}

export async function fetchWeaveState(client: unknown, sessionID: string) {
  const weave = getWeaveMethod(client)
  if (!weave) return undefined
  try {
    const result = await weave({ sessionID })
    return result?.data
  } catch {
    return undefined
  }
}
