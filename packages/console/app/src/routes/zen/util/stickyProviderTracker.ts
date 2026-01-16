import { Resource } from "@opencode-ai/console-resource"

export function createStickyTracker(stickyProvider: "strict" | "prefer" | undefined, session: string) {
  if (!stickyProvider) return
  if (!session) return
  const key = `sticky:${session}`

  return {
    get: async () => {
      return await Resource.GatewayKv.get(key)
    },
    set: async (providerId: string) => {
      await Resource.GatewayKv.put(key, providerId, { expirationTtl: 86400 })
    },
  }
}
