import { env } from "cloudflare:workers"
export { waitUntil } from "cloudflare:workers"

export const Resource = new Proxy(
  {},
  {
    get(_target, prop: string) {
      if (prop in env) {
        // @ts-expect-error
        const value = env[prop]
        return typeof value === "string" ? JSON.parse(value) : value
      } else if (prop === "App") {
        // @ts-expect-error
        return JSON.parse(env.SST_RESOURCE_App)
      }
      throw new Error(`"${prop}" is not linked in your sst.config.ts (cloudflare)`)
    },
  },
) as Record<string, any>
