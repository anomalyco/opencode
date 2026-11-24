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
 * on a periodic timer; the last good inventory is kept when the gateway is unreachable or
 * the key is invalid.
 */
export default Plugin.define({
  id: "opencode.hostman",
  async setup(ctx) {
    const options = resolveOptions(ctx.options)
    const state: { current: Model.Info[]; running: boolean } = { current: [], running: false }

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

    const discover = async () => {
      if (state.running) return
      state.running = true
      try {
        // No connection yet means no key: stay silent, the loop retries on the next tick.
        const connection = await ctx.integration.connection.active(PROVIDER_ID)
        if (!connection) return
        const credential = await ctx.integration.connection.resolve(connection)
        const key = credential?.type === "key" ? credential.key : undefined
        if (!key) return
        const response = await fetch(`${options.baseURL}/models`, {
          headers: { authorization: `Bearer ${key}` },
          signal: AbortSignal.timeout(MODEL_FETCH_TIMEOUT_MS),
        })
        if (!response.ok) throw new Error(`GET /models answered HTTP ${response.status}`)
        const next = parseModels(await response.json())
        if (JSON.stringify(next) === JSON.stringify(state.current)) return
        state.current = next
        await ctx.provider.reload()
      } catch (cause) {
        // Keep the last good inventory and report the failure once per refresh tick.
        console.warn("[opencode.hostman] model discovery failed:", cause instanceof Error ? cause.message : cause)
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
