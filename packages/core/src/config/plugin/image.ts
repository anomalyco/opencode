export * as ConfigImagePlugin from "./image.js"

import { define } from "@opencode-ai/plugin/effect/plugin"
import { Effect, Stream } from "effect"
import { Config } from "../../config.js"
import { Image } from "../../image.js"

export const Plugin = define({
  id: "opencode.config.image",
  effect: Effect.fn(function* (ctx) {
    const config = yield* Config.Service
    const image = yield* Image.Service
    const loaded = { entries: yield* config.entries() }
    yield* image.transform((draft) => {
      for (const entry of loaded.entries) {
        if (entry.type !== "document") continue
        const configured = entry.info.media?.image
        if (!configured) continue
        draft.configure({
          ...(configured.auto_resize === undefined ? {} : { autoResize: configured.auto_resize }),
          ...(configured.max_width === undefined ? {} : { maxWidth: configured.max_width }),
          ...(configured.max_height === undefined ? {} : { maxHeight: configured.max_height }),
          ...(configured.max_base64_bytes === undefined ? {} : { maxBase64Bytes: configured.max_base64_bytes }),
        })
      }
    })
    yield* ctx.event.subscribe().pipe(
      Stream.filter((event) => event.type === "config.updated"),
      Stream.runForEach(() =>
        config.entries().pipe(
          Effect.tap((entries) => Effect.sync(() => (loaded.entries = entries))),
          Effect.andThen(image.reload()),
        ),
      ),
      Effect.forkScoped({ startImmediately: true }),
    )
  }),
})
