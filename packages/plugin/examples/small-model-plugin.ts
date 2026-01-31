import type { Plugin } from "@opencode-ai/plugin"

export const SmallModelPreferencesPlugin: Plugin = async (ctx) => {
  const registration = {
    id: "small-model-config",
    title: "Small Model",
    icon: "chip",
    requiresRestart: true,
    schema: {
      small_model: {
        type: "select",
        description: "Select model for small subtasks and reasoning",
        provider: "models",
      },
    },
    defaults: {
      small_model: undefined,
    },
    ui: { group: "Models", order: 2 },
  }

  return {
    preferences: {
      register: async () => registration,

      getValues: async () => {
        // read from config if available; fallback to defaults
        try {
          const cfg = await ctx.client.config.get()
          return { small_model: cfg.small_model ?? registration.defaults.small_model }
        } catch {
          return registration.defaults
        }
      },

      validate: async ({ key, value }) => {
        if (key === "small_model") {
          if (!value) return { valid: false, error: "Model is required" }
          // basic format check provider/model
          if (!/^[^\/]+\/.+/.test(value)) return { valid: false, error: "Must be in provider/model format" }
          // Optionally check provider list via client
          try {
            const providers = await ctx.client.config.providers()
            const found = providers.providers.some((p: any) => p.models && p.models.some((m: any) => `${p.id}/${m.id}` === value))
            return { valid: found, error: found ? undefined : "Model not found in configured providers" }
          } catch {
            return { valid: true }
          }
        }
        return { valid: true }
      },

      change: async ({ key, value }) => {
        if (key === "small_model") {
          // persist via client config set
          try {
            const cfg = await ctx.client.config.get()
            cfg.small_model = value
            await ctx.client.config.set(cfg)
            await ctx.client.tui.showToast({ message: "Small model updated. Restart Desktop to apply.", variant: "info", duration: 5000 })
          } catch (err) {
            // swallow - registry will have handled validation earlier
          }
        }
      },
    },
  }
}

export default SmallModelPreferencesPlugin
