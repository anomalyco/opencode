import { Instance } from "@/project/instance"
import { Plugin } from "../plugin"
import { mapValues } from "remeda"
import z from "zod"
import { fn } from "@/util/fn"
import type { AuthOuathResult, AuthHook, Hooks } from "@opencode-ai/plugin"
import { NamedError } from "@opencode-ai/util/error"
import { Auth } from "@/auth"

export namespace ProviderAuth {
  // Extended method type that tracks the authorize function for OAuth routing
  interface TrackedMethod {
    type: "oauth" | "api"
    label: string
    prompts?: AuthHook["methods"][number]["prompts"]
    authorize?: (inputs?: Record<string, string>) => Promise<AuthOuathResult>
    apiAuthorize?: (inputs?: Record<string, string>) => Promise<
      | { type: "success"; key: string; provider?: string }
      | { type: "failed" }
    >
  }

  interface MergedAuth {
    provider: string
    methods: TrackedMethod[]
    loader?: AuthHook["loader"]
  }

  /**
   * Check if a plugin is a native OpenCode plugin (doesn't need source label)
   */
  function isNativePlugin(pkg: string | undefined): boolean {
    if (!pkg) return false
    return Plugin.DEFAULT_PLUGINS.some((native) => pkg === native || pkg.startsWith(`${native}@`))
  }

  /**
   * Extract a short display name from a package name
   * e.g. "opencode-antigravity-auth" -> "antigravity"
   *      "@tarquinen/opencode-dcp" -> "dcp"
   *      "opencode-websearch-cited" -> "websearch-cited"
   */
  function getPluginDisplayName(pkg: string | undefined): string | undefined {
    if (!pkg) return undefined
    // Remove scope prefix (@foo/)
    const name = pkg.startsWith("@") ? pkg.split("/")[1] ?? pkg : pkg
    // Remove common prefixes/suffixes
    return name
      .replace(/^opencode-/, "")
      .replace(/-auth$/, "")
      .replace(/-plugin$/, "")
  }

  /**
   * Check if a method label is a generic API key entry (shouldn't be labeled with plugin source)
   * These are functionally identical to the native fallback mechanism
   */
  function isGenericApiKeyLabel(label: string): boolean {
    const normalized = label.toLowerCase().trim()
    return (
      normalized === "manually enter api key" ||
      normalized === "api key" ||
      normalized === "enter api key"
    )
  }

  /**
   * Build label for an auth method, adding plugin source for non-native plugins
   */
  function buildMethodLabel(baseLabel: string, pluginSource: string | undefined, methodType: "oauth" | "api"): string {
    // Native OpenCode plugins don't need source labels
    if (isNativePlugin(pluginSource)) {
      return baseLabel
    }
    // Generic API key methods don't need source labels (same as native fallback)
    if (methodType === "api" && isGenericApiKeyLabel(baseLabel)) {
      return baseLabel
    }
    // Non-native plugins show their source for distinctive methods
    const displayName = getPluginDisplayName(pluginSource)
    return displayName ? `${baseLabel} (${displayName})` : baseLabel
  }

  const state = Instance.state(async () => {
    const plugins = await Plugin.list()
    const methods: Record<string, MergedAuth> = {}

    for (const plugin of plugins) {
      if (!plugin.auth?.provider) continue

      const providerId = plugin.auth.provider
      const pluginSource = plugin._source
      const existing = methods[providerId]

      if (existing) {
        // Merge methods from additional plugins, deduplicating by function reference or type+label
        for (const method of plugin.auth.methods) {
          // Check for duplicates:
          // - For OAuth methods: same authorize function reference means duplicate
          // - For API methods: same type + label means duplicate
          const isDuplicate = existing.methods.some((m) => {
            if (method.type === "oauth" && m.type === "oauth") {
              // Same authorize function = same method (handles aliased exports)
              return m.authorize === method.authorize
            }
            // For API methods or mixed comparison, check type + label
            return m.type === method.type && m.label === method.label
          })

          if (isDuplicate) continue

          // Build label with plugin source for non-native plugins
          let label = buildMethodLabel(method.label, pluginSource, method.type)

          // Handle label collisions
          const existingLabels = new Set(existing.methods.map((m) => m.label))
          if (existingLabels.has(label)) {
            let counter = 2
            const baseLabel = label
            while (existingLabels.has(label)) {
              label = `${baseLabel} ${counter}`
              counter++
            }
          }

          existing.methods.push({
            type: method.type,
            label,
            prompts: method.prompts,
            authorize: method.type === "oauth" ? method.authorize : undefined,
            apiAuthorize: method.type === "api" && "authorize" in method ? method.authorize : undefined,
          })
        }

        // Keep the first loader (don't overwrite)
        if (!existing.loader && plugin.auth.loader) {
          existing.loader = plugin.auth.loader
        }
      } else {
        // First plugin for this provider
        const seenMethods: TrackedMethod[] = []
        const seenAuthorizeFns = new Set<Function>()
        const seenApiLabels = new Set<string>()

        for (const m of plugin.auth.methods) {
          if (m.type === "oauth") {
            if (seenAuthorizeFns.has(m.authorize)) continue
            seenAuthorizeFns.add(m.authorize)
          } else {
            const key = `${m.type}:${m.label}`
            if (seenApiLabels.has(key)) continue
            seenApiLabels.add(key)
          }

          seenMethods.push({
            type: m.type,
            label: buildMethodLabel(m.label, pluginSource, m.type),
            prompts: m.prompts,
            authorize: m.type === "oauth" ? m.authorize : undefined,
            apiAuthorize: m.type === "api" && "authorize" in m ? m.authorize : undefined,
          })
        }

        methods[providerId] = {
          provider: providerId,
          methods: seenMethods,
          loader: plugin.auth.loader,
        }
      }
    }

    return { methods, pending: {} as Record<string, AuthOuathResult> }
  })

  export const Method = z
    .object({
      type: z.union([z.literal("oauth"), z.literal("api")]),
      label: z.string(),
    })
    .meta({
      ref: "ProviderAuthMethod",
    })
  export type Method = z.infer<typeof Method>

  export async function methods() {
    const s = await state().then((x) => x.methods)
    return mapValues(s, (x) =>
      x.methods.map(
        (y): Method => ({
          type: y.type,
          label: y.label,
        }),
      ),
    )
  }

  export const Authorization = z
    .object({
      url: z.string(),
      method: z.union([z.literal("auto"), z.literal("code")]),
      instructions: z.string(),
    })
    .meta({
      ref: "ProviderAuthAuthorization",
    })
  export type Authorization = z.infer<typeof Authorization>

  export const authorize = fn(
    z.object({
      providerID: z.string(),
      method: z.number(),
    }),
    async (input): Promise<Authorization | undefined> => {
      const auth = await state().then((s) => s.methods[input.providerID])
      if (!auth) return undefined

      const method = auth.methods[input.method]
      if (!method) return undefined

      if (method.type === "oauth" && method.authorize) {
        const result = await method.authorize()
        await state().then((s) => (s.pending[input.providerID] = result))
        return {
          url: result.url,
          method: result.method,
          instructions: result.instructions,
        }
      }
    },
  )

  export const callback = fn(
    z.object({
      providerID: z.string(),
      method: z.number(),
      code: z.string().optional(),
    }),
    async (input) => {
      const match = await state().then((s) => s.pending[input.providerID])
      if (!match) throw new OauthMissing({ providerID: input.providerID })
      let result

      if (match.method === "code") {
        if (!input.code) throw new OauthCodeMissing({ providerID: input.providerID })
        result = await match.callback(input.code)
      }

      if (match.method === "auto") {
        result = await match.callback()
      }

      if (result?.type === "success") {
        if ("key" in result) {
          await Auth.set(input.providerID, {
            type: "api",
            key: result.key,
          })
        }
        if ("refresh" in result) {
          await Auth.set(input.providerID, {
            type: "oauth",
            access: result.access,
            refresh: result.refresh,
            expires: result.expires,
          })
        }
        return
      }

      throw new OauthCallbackFailed({})
    },
  )

  export const api = fn(
    z.object({
      providerID: z.string(),
      key: z.string(),
    }),
    async (input) => {
      await Auth.set(input.providerID, {
        type: "api",
        key: input.key,
      })
    },
  )

  export const OauthMissing = NamedError.create(
    "ProviderAuthOauthMissing",
    z.object({
      providerID: z.string(),
    }),
  )
  export const OauthCodeMissing = NamedError.create(
    "ProviderAuthOauthCodeMissing",
    z.object({
      providerID: z.string(),
    }),
  )

  export const OauthCallbackFailed = NamedError.create("ProviderAuthOauthCallbackFailed", z.object({}))
}
