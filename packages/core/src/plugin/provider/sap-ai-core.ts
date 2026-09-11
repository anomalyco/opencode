import { Effect } from "effect"
import { pathToFileURL } from "url"
import { define } from "../internal"
import { Npm } from "../../npm"
import { ProviderV2 } from "../../provider"

type FetchLike = (url: string | URL | Request, init?: RequestInit) => Promise<Response>

export function sapAICoreFetch(upstream: FetchLike = fetch) {
  return async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const response = await upstream(url, init)
    if (response.body && response.headers.get("content-type")?.includes("text/event-stream")) {
      const reader = response.body.getReader()
      const encoder = new TextEncoder()
      const decoder = new TextDecoder()
      const stream = new ReadableStream({
        async pull(ctrl) {
          const { done, value } = await reader.read()
          if (done) {
            ctrl.close()
            return
          }
          let text = decoder.decode(value, { stream: true })
          text = text.replace(/"finish_reason"\s*:\s*null/g, '"finish_reason":"stop"')
          ctrl.enqueue(encoder.encode(text))
        },
        cancel() {
          reader.cancel()
        },
      })
      return new Response(stream, { headers: response.headers, status: response.status })
    }
    return response
  }
}

export const SapAICorePlugin = define({
  id: "sap-ai-core",
  effect: Effect.fn(function* (ctx) {
    const npm = yield* Npm.Service
    yield* ctx.aisdk.sdk(
      Effect.fn(function* (evt) {
        if (evt.model.providerID !== ProviderV2.ID.make("sap-ai-core")) return
        const serviceKey =
          process.env.AICORE_SERVICE_KEY ??
          (typeof evt.options.serviceKey === "string" ? evt.options.serviceKey : undefined)
        if (serviceKey && !process.env.AICORE_SERVICE_KEY) process.env.AICORE_SERVICE_KEY = serviceKey

        const installedPath = evt.package.startsWith("file://")
          ? evt.package
          : (yield* npm.add(evt.package).pipe(Effect.orDie)).entrypoint
        if (!installedPath) throw new Error(`Package ${evt.package} has no import entrypoint`)

        const mod = yield* Effect.promise(async () => {
          return (await import(
            installedPath.startsWith("file://") ? installedPath : pathToFileURL(installedPath).href
          )) as Record<string, (options: any) => any>
        }).pipe(Effect.orDie)
        const match = Object.keys(mod).find((name) => name.startsWith("create"))
        if (!match) throw new Error(`Package ${evt.package} has no provider factory export`)

        const upstream = typeof evt.options.fetch === "function" ? (evt.options.fetch as FetchLike) : undefined
        evt.sdk = mod[match]({
          ...evt.options,
          ...(serviceKey
            ? { deploymentId: process.env.AICORE_DEPLOYMENT_ID, resourceGroup: process.env.AICORE_RESOURCE_GROUP }
            : {}),
          fetch: sapAICoreFetch(upstream) as typeof fetch,
        })
      }),
    )
    yield* ctx.aisdk.language(
      Effect.fn(function* (evt) {
        if (evt.model.providerID !== ProviderV2.ID.make("sap-ai-core")) return
        evt.language = evt.sdk(evt.model.api.id)
      }),
    )
  }),
})
