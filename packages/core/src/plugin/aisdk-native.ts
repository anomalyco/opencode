export * as AISDKNativePlugin from "./aisdk-native.js"

import { Effect } from "effect"
import { define } from "@opencode/plugin/effect/plugin"
import { AISDKNative } from "../aisdk-native.js"

/** Legacy `aisdk:` packages written by config or plugins become their native replacements before anything reads them. */
export const Plugin = define({
  id: "opencode.aisdk-native",
  effect: Effect.fn(function* (ctx) {
    yield* ctx.catalog.transform((catalog) => {
      for (const record of catalog.provider.list()) AISDKNative.rewrite(record.provider, record.models.values())
    })
  }),
})
