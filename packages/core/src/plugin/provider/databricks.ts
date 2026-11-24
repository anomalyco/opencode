import { Effect } from "effect"
import { define } from "@opencode/plugin/effect/plugin"

export const DatabricksPlugin = define({
  id: "opencode.provider.databricks",
  effect: Effect.fn(function* (ctx) {
    yield* ctx.integration.transform((editor) => {
      // models.dev also lists DATABRICKS_HOST, which only fills the base URL template.
      editor.method.update({ integrationID: "databricks", method: { type: "env", names: ["DATABRICKS_TOKEN"] } })
    })
    yield* ctx.provider.transform((evt) => {
      // The template adds its own scheme, but Databricks tooling documents DATABRICKS_HOST with one.
      const host = process.env.DATABRICKS_HOST?.replace(/^https?:\/\//i, "").replace(/\/+$/, "")
      if (!host) return
      const baseURL = evt.get("databricks")?.provider.settings?.baseURL
      if (typeof baseURL !== "string" || !baseURL.includes("${DATABRICKS_HOST}")) return
      evt.update("databricks", (provider) => {
        provider.settings = { ...provider.settings, baseURL: baseURL.replaceAll("${DATABRICKS_HOST}", host) }
      })
    })
    yield* ctx.model.transform((models) => {
      for (const item of models.list("databricks")) {
        // Databricks caches Claude only through explicit `cache_control` breakpoints.
        if (!(item.modelID ?? item.id).includes("claude")) continue
        models.update(item.providerID, item.id, (model) => {
          model.compatibility = { cacheFormat: "anthropic", ...model.compatibility }
        })
      }
    })
  }),
})
