import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { Plugin } from "@opencode/core/plugin"
import { PluginHost } from "@opencode/core/plugin/host"
import { DatabricksPlugin } from "@opencode/core/plugin/provider/databricks"
import { Provider } from "@opencode/core/provider"
import { withEnv } from "../fixture/env"
import { testEffect } from "../lib/effect"
import { PluginTestLayer } from "./fixture"

const it = testEffect(PluginTestLayer)
const providerID = Provider.ID.make("databricks")

const baseURLFor = (host: string) =>
  withEnv({ DATABRICKS_HOST: host }, () =>
    Effect.gen(function* () {
      const catalog = yield* Provider.Service
      yield* catalog.transform((catalog) => {
        catalog.update(providerID, (item) => {
          item.settings = { baseURL: "https://${DATABRICKS_HOST}/ai-gateway/mlflow/v1" }
        })
      })
      const plugin = yield* Plugin.Service
      yield* DatabricksPlugin.effect(yield* PluginHost.make(plugin, "test"))
      return (yield* catalog.get(providerID))?.settings?.baseURL
    }),
  )

describe("DatabricksPlugin", () => {
  it.effect("fills the base URL from a bare host", () =>
    Effect.gen(function* () {
      expect(yield* baseURLFor("adb-123.azuredatabricks.net")).toBe(
        "https://adb-123.azuredatabricks.net/ai-gateway/mlflow/v1",
      )
    }),
  )

  it.effect("fills the base URL from a host that includes the scheme", () =>
    Effect.gen(function* () {
      expect(yield* baseURLFor("https://adb-123.azuredatabricks.net/")).toBe(
        "https://adb-123.azuredatabricks.net/ai-gateway/mlflow/v1",
      )
    }),
  )
})
