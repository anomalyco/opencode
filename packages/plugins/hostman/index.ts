import { Model, Plugin, Provider } from "@opencode/plugin"
import { PACKAGE, PROVIDER_ID, parseModels, resolveOptions } from "./hostman.js"

const providerID = Provider.ID.make(PROVIDER_ID)
const MODEL_FETCH_TIMEOUT_MS = 15_000

/**
 * Registers the Hostman AI Gateway as a provider. The gateway is OpenAI-compatible
 * (`Chat Completions`, `/models`), so the native `openai-compatible` provider package is
 * used as-is. The API key is resolved from the active `hostman` integration connection:
 * a key stored through `/connect` wins over the `HOSTMAN_API_KEY` environment variable.
 * Models are discovered from `GET {baseURL}/models` and refreshed when a `provider.updated`
 * event fires (for example after a credential is stored or removed through `/connect`) and
 * on a periodic timer. A trigger during an in-flight fetch queues a rerun instead of being
 * dropped, and a response fetched for a connection that is no longer active is discarded.
 * The last good inventory is kept when the gateway is unreachable or the key is invalid.
 */
export default Plugin.define({
  id: "opencode.hostman",
  async setup(ctx) {
    const options = resolveOptions(ctx.options)
    const state: { current: Model.Info[]; running: boolean; queued: boolean } = {
      current: [],
      running: false,
      queued: false,
    }

    await ctx.provider.transform((evt) => {
      const record = evt.get(PROVIDER_ID)
      if (!record) {
        evt.add({
          info: {
            id: providerID,
            name: "Hostman",
            // Available once the integration has a connection (stored key or env var).
            activation: "auto",
            package: PACKAGE,
            settings: { baseURL: options.baseURL },
          },
          models: state.current,
        })
        return
      }
      evt.update(PROVIDER_ID, (provider) => {
        provider.name = "Hostman"
        if (!provider.package) provider.package = PACKAGE
        if (provider.settings?.baseURL === undefined) provider.settings = { ...provider.settings, baseURL: options.baseURL }
      })
      if (state.current.length > 0) evt.models.set(PROVIDER_ID, state.current)
    })

    await ctx.integration.transform((integrations) => {
      integrations.update(PROVIDER_ID, (item) => {
        item.name = "Hostman"
      })
      integrations.method.update({
        integrationID: PROVIDER_ID,
        method: { type: "env", names: [options.envVar] },
      })
      integrations.method.update({
        integrationID: PROVIDER_ID,
        method: { type: "key", label: "Manually enter API Key" },
      })
    })

    // Identity of an access choice; labels and refreshed token values do not identify a new connection.
    const connectionKey = (
      connection:
        | { readonly type: "credential"; readonly id: string }
        | { readonly type: "env"; readonly name: string },
    ) => (connection.type === "credential" ? `credential:${connection.id}` : `env:${connection.name}`)

    const discover = async () => {
      if (state.running) {
        // A trigger during an in-flight fetch queues a rerun instead of being dropped.
        state.queued = true
        return
      }
      state.running = true
      try {
        // The condition reruns the attempt when a trigger arrived while it was in flight.
        do {
          state.queued = false
          try {
            // No connection yet means no key: skip this attempt, the periodic tick retries.
            const connection = await ctx.integration.connection.active(PROVIDER_ID)
            if (!connection) continue
            const credential = await ctx.integration.connection.resolve(connection)
            const key = credential?.type === "key" ? credential.key : undefined
            if (!key) continue
            const response = await fetch(`${options.baseURL}/models`, {
              headers: { authorization: `Bearer ${key}` },
              signal: AbortSignal.timeout(MODEL_FETCH_TIMEOUT_MS),
            })
            if (!response.ok) throw new Error(`GET /models answered HTTP ${response.status}`)
            const next = parseModels(await response.json())
            // Drop the response when the active connection changed while the request was in flight.
            const active = await ctx.integration.connection.active(PROVIDER_ID)
            if (!active || connectionKey(active) !== connectionKey(connection)) {
              state.queued = true
              continue
            }
            if (JSON.stringify(next) === JSON.stringify(state.current)) continue
            state.current = next
            await ctx.provider.reload()
          } catch (cause) {
            // Keep the last good inventory and report the failure once per refresh tick.
            console.warn("[opencode.hostman] model discovery failed:", cause instanceof Error ? cause.message : cause)
          }
        } while (state.queued)
      } finally {
        state.running = false
      }
    }

    // Storing a credential through /connect surfaces as a provider.updated event; refresh
    // discovery then so the inventory appears immediately instead of on the next periodic tick.
    const events = new AbortController()
    const stream = ctx.event.subscribe({ types: ["provider.updated"], signal: events.signal })
    void (async () => {
      for await (const _ of stream) void discover()
    })().catch(() => undefined)

    await discover()
    const timer = setInterval(() => {
      void discover()
    }, options.refreshIntervalMs)
    return () => {
      events.abort()
      clearInterval(timer)
    }
  },
})
