import { Effect } from "effect"
import { define } from "@opencode/plugin/effect/plugin"

export const DatabricksPlugin = define({
  id: "opencode.provider.databricks",
  effect: Effect.fn(function* (ctx) {
    yield* ctx.integration.transform((editor) => {
      // models.dev also lists DATABRICKS_HOST, which only fills the base URL template.
      editor.method.update({ integrationID: "databricks", method: { type: "env", names: ["DATABRICKS_TOKEN"] } })
    })
  }),
})
