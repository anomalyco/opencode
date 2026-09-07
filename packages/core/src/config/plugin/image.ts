export * as ConfigImagePlugin from "./image.js"

import { define } from "@opencode-ai/plugin/effect/plugin"
import { Effect } from "effect"
import { Config } from "../../config.js"
import { Image } from "../../image.js"
import { ConfigEntryObserver } from "./entry-observer.js"

export const Plugin = define({
  id: "opencode.config.image",
  effect: Effect.fn(function* (ctx) {
    const config = yield* Config.Service
    const image = yield* Image.Service
    const loaded = yield* ConfigEntryObserver.observe(config, ctx.event, image.reload())
    yield* image.transform((editor) => {
      for (const entry of loaded.entries) {
        if (entry.type !== "document") continue
        const configured = entry.info.media?.image
        if (!configured) continue
        editor.configure({
          ...(configured.auto_resize === undefined ? {} : { autoResize: configured.auto_resize }),
          ...(configured.max_width === undefined ? {} : { maxWidth: configured.max_width }),
          ...(configured.max_height === undefined ? {} : { maxHeight: configured.max_height }),
          ...(configured.max_base64_bytes === undefined ? {} : { maxBase64Bytes: configured.max_base64_bytes }),
        })
      }
    })
  }),
})
