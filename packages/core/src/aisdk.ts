export * as AISDK from "./aisdk"

import { makeLocationNode } from "./effect/app-node"
import type { LanguageModelV3 } from "@ai-sdk/provider"
import { Cause, Context, Effect, Layer, Schema, Scope, Semaphore } from "effect"
import { ModelV2 } from "./model"
import { ProviderV2 } from "./provider"
import { State } from "./state"

const NIM_BACKEND_KEYWORDS = ["nvidia", "nim", "integrate.api.nvidia.com"]

interface BackendState {
  maxConcurrent: number
  inFlight: number
  successWindow: number[]
  errorWindow: number[]
  lastErrorTime: number
}

const backends = new Map<string, BackendState>()
let backendWarned = false

function getBackendKey(url: string): string {
  const match = NIM_BACKEND_KEYWORDS.find((k) => url.toLowerCase().includes(k.toLowerCase()))
  if (match) return match
  const host = getHost(url)
  return host || "default"
}

function getHost(url: string): string {
  try { return new URL(url).host } catch { return "" }
}

function getBackendState(url: string): BackendState {
  const key = getBackendKey(url)
  let state = backends.get(key)
  if (!state) {
    state = { maxConcurrent: 32, inFlight: 0, successWindow: [], errorWindow: [], lastErrorTime: 0 }
    backends.set(key, state)
  }
  return state
}

function getAdjustedPermits(state: BackendState): number {
  if (state.errorWindow.length === 0) return state.maxConcurrent
  const now = Date.now()
  const recent = state.errorWindow.filter(t => now - t < 60000).length
  if (recent === 0) return state.maxConcurrent
  if (recent <= 1) return Math.max(4, state.maxConcurrent - 4)
  if (recent <= 3) return Math.max(2, Math.floor(state.maxConcurrent / 2))
  return Math.max(1, Math.floor(state.maxConcurrent / 4))
}

const semaphoreMap = new Map<string, Semaphore.Semaphore>()

function getSemaphore(url: string): Semaphore.Semaphore | undefined {
  const key = NIM_BACKEND_KEYWORDS.find((k) => url.toLowerCase().includes(k.toLowerCase()))
  if (!key) return
  const state = getBackendState(url)
  const permits = getAdjustedPermits(state)
  const existing = semaphoreMap.get(key)
  if (existing) return existing
  const semaphore = Semaphore.makeUnsafe(permits)
  semaphoreMap.set(key, semaphore)
  return semaphore
}

function rebuildSemaphore(key: string, permits: number) {
  semaphoreMap.set(key, Semaphore.makeUnsafe(permits))
}

function reportResponse(url: string, ok: boolean) {
  const state = getBackendState(url)
  const now = Date.now()
  if (ok) {
    state.successWindow.push(now)
    if (state.successWindow.length > 100) state.successWindow.shift()
    return
  }
  state.errorWindow.push(now)
  state.lastErrorTime = now
  if (state.errorWindow.length > 50) state.errorWindow.shift()
}

type SDK = any

export interface SDKEvent {
  readonly model: ModelV2.Info
  readonly package: string
  readonly options: Record<string, any>
  sdk?: SDK
}

export interface LanguageEvent {
  readonly model: ModelV2.Info
  readonly sdk: SDK
  readonly options: Record<string, any>
  language?: LanguageModelV3
}

function wrapSSE(res: Response, ms: number, ctl: AbortController) {
  if (typeof ms !== "number" || ms <= 0) return res
  if (!res.body) return res
  if (!res.headers.get("content-type")?.includes("text/event-stream")) return res

  const reader = res.body.getReader()
  const body = new ReadableStream<Uint8Array>({
    async pull(ctrl) {
      const part = await new Promise<Awaited<ReturnType<typeof reader.read>>>((resolve, reject) => {
        const id = setTimeout(() => {
          const err = new Error("SSE read timed out")
          ctl.abort(err)
          reader.cancel(err).catch(() => {})
          reject(err)
        }, ms)

        reader.read().then(
          (part) => {
            clearTimeout(id)
            resolve(part)
          },
          (err) => {
            clearTimeout(id)
            reject(err)
          },
        )
      })

      if (part.done) {
        ctrl.close()
        return
      }

      ctrl.enqueue(part.value)
    },
    async cancel(reason) {
      ctl.abort(reason)
      await reader.cancel(reason)
    },
  })

  return new Response(body, {
    headers: new Headers(res.headers),
    status: res.status,
    statusText: res.statusText,
  })
}

function prepareOptions(model: ModelV2.Info, pkg: string) {
  const options: Record<string, any> = {
    name: model.providerID,
    ...(model.api.type === "aisdk" ? (model.api.settings ?? {}) : {}),
    ...model.request.body,
  }
  if (model.api.type === "aisdk" && model.api.url) options.baseURL = model.api.url

  const customFetch = options.fetch
  const chunkTimeout = options.chunkTimeout
  delete options.chunkTimeout
  const isKnownBackend = (url: string) => NIM_BACKEND_KEYWORDS.some((k) => url.toLowerCase().includes(k.toLowerCase()))

  options.fetch = async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url
    const base = init?.signal

    const doFetch = async (opts: RequestInit): Promise<Response> => {
      return (typeof customFetch === "function" ? customFetch : fetch)(input, { ...opts, timeout: false })
    }

    const attemptFetch = async (tryNum: number): Promise<Response> => {
      const opts: RequestInit = { ...(init ?? {}) }
      const signals: (AbortSignal | AbortController)[] = [
        opts.signal as AbortSignal | undefined,
        typeof chunkTimeout === "number" && chunkTimeout > 0 ? new AbortController() : undefined,
        options.timeout !== undefined && options.timeout !== null && options.timeout !== false
          ? AbortSignal.timeout(options.timeout)
          : undefined,
      ].filter((item): item is AbortSignal | AbortController => Boolean(item))
      const chunkAbortCtl = signals.find((item): item is AbortController => item instanceof AbortController)
      const abortSignals = signals.map((item) => (item instanceof AbortController ? item.signal : item))
      if (abortSignals.length === 1) opts.signal = abortSignals[0]
      if (abortSignals.length > 1) opts.signal = AbortSignal.any(abortSignals)

      if (
        (pkg === "@ai-sdk/openai" || pkg === "@ai-sdk/azure" || pkg === "@ai-sdk/amazon-bedrock/mantle") &&
        opts.body &&
        opts.method === "POST"
      ) {
        const body = JSON.parse(opts.body as string)
        if (body.store !== true && Array.isArray(body.input)) {
          for (const item of body.input) {
            if ("id" in item) delete item.id
          }
          opts.body = JSON.stringify(body)
        }
      }

      const state = isKnownBackend(url) ? getBackendState(url) : undefined
      if (state) state.inFlight++

      let res: Response
      try {
        res = await doFetch(opts)
      } finally {
        if (state) state.inFlight--
      }

      if (res.ok) {
        if (state) reportResponse(url, true)
        if (!chunkAbortCtl || typeof chunkTimeout !== "number") return res
        return wrapSSE(res, chunkTimeout, chunkAbortCtl)
      }

      const isRateLimited = res.status === 429 || res.status === 503
      let isNimLimit = false
      if (isRateLimited && tryNum < 3) {
        const body = await res.clone().text().catch(() => "")
        isNimLimit = /worker.*local.*total.*request.*limit.*reached/i.test(body)
      }

      if (isNimLimit || (isRateLimited && isKnownBackend(url) && tryNum < 3)) {
        if (state) reportResponse(url, false)
        const delay = isNimLimit
          ? Math.min(2000 * Math.pow(3, tryNum) + Math.random() * 2000, 45000)
          : Math.min(1000 * Math.pow(2, tryNum) + Math.random() * 1000, 30000)
        await new Promise<void>((resolve) => {
          if (base?.aborted) { resolve(); return }
          const timer = setTimeout(resolve, delay)
          base?.addEventListener("abort", () => { clearTimeout(timer); resolve() }, { once: true })
        })
        return attemptFetch(tryNum + 1)
      }

      return res
    }

    const semaphore = isKnownBackend(url) ? getSemaphore(url) : undefined
    if (semaphore) {
      return Effect.runPromise(Semaphore.withPermit(semaphore)(Effect.promise(() => attemptFetch(0))))
    }
    return attemptFetch(0)
  }

  return options
}

export class InitError extends Schema.TaggedErrorClass<InitError>()("AISDK.InitError", {
  providerID: ProviderV2.ID,
  cause: Schema.Defect(),
}) {}

function initError(providerID: ProviderV2.ID) {
  return Effect.catchCause((cause) => Effect.fail(new InitError({ providerID, cause: Cause.squash(cause) })))
}

export interface Interface {
  readonly hook: {
    readonly sdk: (
      callback: (event: SDKEvent) => Effect.Effect<void> | void,
    ) => Effect.Effect<State.Registration, never, Scope.Scope>
    readonly language: (
      callback: (event: LanguageEvent) => Effect.Effect<void> | void,
    ) => Effect.Effect<State.Registration, never, Scope.Scope>
  }
  readonly runSDK: (event: SDKEvent) => Effect.Effect<SDKEvent>
  readonly runLanguage: (event: LanguageEvent) => Effect.Effect<LanguageEvent>
  readonly language: (model: ModelV2.Info) => Effect.Effect<LanguageModelV3, InitError>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/v2/AISDK") {}

export const locationLayer = Layer.effect(
  Service,
  Effect.gen(function* () {
    let sdkHooks: ((event: SDKEvent) => Effect.Effect<void> | void)[] = []
    let languageHooks: ((event: LanguageEvent) => Effect.Effect<void> | void)[] = []
    const languages = new Map<string, LanguageModelV3>()
    const sdks = new Map<string, SDK>()

    const register = <Event>(
      hooks: () => ((event: Event) => Effect.Effect<void> | void)[],
      update: (hooks: ((event: Event) => Effect.Effect<void> | void)[]) => void,
    ) =>
      Effect.fn("AISDK.hook")(function* (callback: (event: Event) => Effect.Effect<void> | void) {
        const scope = yield* Scope.Scope
        let active = true
        update([...hooks(), callback])
        const dispose = Effect.sync(() => {
          if (!active) return
          active = false
          update(hooks().filter((item) => item !== callback))
        })
        yield* Scope.addFinalizer(scope, dispose)
        return { dispose }
      })

    const run = Effect.fnUntraced(function* <Event>(
      hooks: readonly ((event: Event) => Effect.Effect<void> | void)[],
      event: Event,
    ) {
      for (const hook of hooks) {
        const result = hook(event)
        if (Effect.isEffect(result)) yield* result
      }
      return event
    })

    const service = Service.of({
      hook: {
        sdk: register(
          () => sdkHooks,
          (next) => (sdkHooks = next),
        ),
        language: register(
          () => languageHooks,
          (next) => (languageHooks = next),
        ),
      },
      runSDK: (event) => run(sdkHooks, event),
      runLanguage: (event) => run(languageHooks, event),
      language: Effect.fn("AISDK.language")(function* (model) {
        const key = `${model.providerID}/${model.id}/${model.request.variant ?? "default"}`
        const existing = languages.get(key)
        if (existing) return existing
        if (model.api.type !== "aisdk")
          return yield* new InitError({
            providerID: model.providerID,
            cause: new Error(`Unsupported api ${model.api.type}`),
          })

        const options = prepareOptions(model, model.api.package)
        const sdkKey = JSON.stringify({
          providerID: model.providerID,
          api: model.api,
          options,
        })
        const sdk =
          sdks.get(sdkKey) ??
          (yield* service.runSDK({ model, package: model.api.package, options }).pipe(initError(model.providerID))).sdk
        if (!sdk)
          return yield* new InitError({
            providerID: model.providerID,
            cause: new Error("No AISDK provider plugin returned an SDK"),
          })
        sdks.set(sdkKey, sdk)
        const result = yield* service.runLanguage({ model, sdk, options }).pipe(initError(model.providerID))
        const language = yield* Effect.sync(() => result.language ?? sdk.languageModel(model.api.id)).pipe(
          initError(model.providerID),
        )
        languages.set(key, language)
        return language
      }),
    })
    return service
  }),
)

export const node = makeLocationNode({ service: Service, layer: locationLayer, deps: [] })
