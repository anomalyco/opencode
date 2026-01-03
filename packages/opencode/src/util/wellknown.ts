import z from "zod"
import { Auth } from "../auth"
import { Log } from "./log"

export namespace WellKnown {
  const log = Log.create({ service: "wellknown" })

  export const Skill = z.object({
    description: z.string(),
    url: z.string().url(),
  })
  export type Skill = z.infer<typeof Skill>

  export const Command = z.object({
    description: z.string().optional(),
    url: z.string().url(),
  })
  export type Command = z.infer<typeof Command>

  export const Response = z.object({
    auth: z
      .object({
        command: z.array(z.string()),
        env: z.string(),
      })
      .optional(),
    config: z.record(z.string(), z.any()).optional(),
    skills: z.record(z.string(), Skill).optional(),
    commands: z.record(z.string(), Command).optional(),
  })
  export type Response = z.infer<typeof Response>

  // In-memory cache for wellknown responses
  const indexCache = new Map<string, Response>()

  // In-memory cache for fetched skill/command content
  const contentCache = new Map<string, string>()

  /**
   * Get headers for authenticating to a wellknown endpoint
   */
  async function getHeaders(baseUrl: string): Promise<HeadersInit> {
    const auth = await Auth.get(baseUrl)
    if (auth?.type === "wellknown") {
      return { [auth.key]: auth.token }
    }
    return {}
  }

  /**
   * Get the hostname from a URL for namespacing
   */
  export function getHostname(baseUrl: string): string {
    try {
      return new URL(baseUrl).hostname
    } catch {
      return baseUrl
    }
  }

  /**
   * Fetch and cache the wellknown index for a base URL
   */
  export async function getIndex(baseUrl: string): Promise<Response | undefined> {
    if (indexCache.has(baseUrl)) {
      return indexCache.get(baseUrl)
    }

    try {
      const headers = await getHeaders(baseUrl)
      const response = await fetch(`${baseUrl}/.well-known/opencode`, { headers })

      if (!response.ok) {
        log.warn("failed to fetch wellknown index", { baseUrl, status: response.status })
        return undefined
      }

      const data = await response.json()
      const parsed = Response.safeParse(data)

      if (!parsed.success) {
        log.warn("invalid wellknown response", { baseUrl, issues: parsed.error.issues })
        return undefined
      }

      indexCache.set(baseUrl, parsed.data)
      return parsed.data
    } catch (err) {
      log.warn("error fetching wellknown index", { baseUrl, error: String(err) })
      return undefined
    }
  }

  /**
   * Fetch content from a remote URL with authentication
   */
  export async function fetchContent(url: string, baseUrl: string): Promise<string | undefined> {
    const cacheKey = `${baseUrl}:${url}`
    if (contentCache.has(cacheKey)) {
      return contentCache.get(cacheKey)
    }

    try {
      const headers = await getHeaders(baseUrl)
      const response = await fetch(url, { headers })

      if (!response.ok) {
        log.warn("failed to fetch remote content", { url, status: response.status })
        return undefined
      }

      const content = await response.text()
      contentCache.set(cacheKey, content)
      return content
    } catch (err) {
      log.warn("error fetching remote content", { url, error: String(err) })
      return undefined
    }
  }

  /**
   * Clear the cache for a specific base URL or all caches
   */
  export function clearCache(baseUrl?: string): void {
    if (baseUrl) {
      indexCache.delete(baseUrl)
      // Clear content cache entries for this base URL
      for (const key of contentCache.keys()) {
        if (key.startsWith(`${baseUrl}:`)) {
          contentCache.delete(key)
        }
      }
      log.info("cleared wellknown cache", { baseUrl })
    } else {
      indexCache.clear()
      contentCache.clear()
      log.info("cleared all wellknown caches")
    }
  }

  /**
   * Refresh the wellknown index for a specific base URL or all authenticated endpoints
   */
  export async function refresh(baseUrl?: string): Promise<Map<string, Response>> {
    const results = new Map<string, Response>()

    if (baseUrl) {
      clearCache(baseUrl)
      const index = await getIndex(baseUrl)
      if (index) {
        results.set(baseUrl, index)
      }
    } else {
      clearCache()
      const auth = await Auth.all()
      for (const [url, value] of Object.entries(auth)) {
        if (value.type === "wellknown") {
          const index = await getIndex(url)
          if (index) {
            results.set(url, index)
          }
        }
      }
    }

    return results
  }

  /**
   * Get all authenticated wellknown endpoints
   */
  export async function getAuthenticatedEndpoints(): Promise<string[]> {
    const auth = await Auth.all()
    return Object.entries(auth)
      .filter(([_, value]) => value.type === "wellknown")
      .map(([url]) => url)
  }
}
