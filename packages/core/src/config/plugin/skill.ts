export * as ConfigSkillPlugin from "./skill"

import { define } from "@opencode-ai/plugin/v2/effect/plugin"
import path from "path"
import { Effect, Stream } from "effect"
import { Config } from "../../config"
import { AbsolutePath } from "../../schema"
import { SkillV2 } from "../../skill"
import { Global } from "../../global"
import { Location } from "../../location"

export const Plugin = define({
  id: "opencode.config.skill",
  effect: Effect.fn(function* (ctx) {
    const config = yield* Config.Service
    const global = yield* Global.Service
    const location = yield* Location.Service
    const loaded = { entries: yield* config.entries() }
    yield* ctx.skill.transform((draft) => {
      const directories = loaded.entries.flatMap((entry) => (entry.type === "directory" ? [entry.path] : []))
      const items = loaded.entries.flatMap((entry) => (entry.type === "document" ? (entry.info.skills ?? []) : []))
      for (const directory of directories) {
        draft.source(
          SkillV2.DirectorySource.make({ type: "directory", path: AbsolutePath.make(path.join(directory, "skill")) }),
        )
        draft.source(
          SkillV2.DirectorySource.make({
            type: "directory",
            path: AbsolutePath.make(path.join(directory, "skills")),
          }),
        )
      }
      for (const item of items) {
        if (URL.canParse(item) && /^(https?:)$/.test(new URL(item).protocol)) {
          draft.source(SkillV2.UrlSource.make({ type: "url", url: item }))
          continue
        }
        const expanded = item.startsWith("~/") ? path.join(global.home, item.slice(2)) : item
        draft.source(
          SkillV2.DirectorySource.make({
            type: "directory",
            path: AbsolutePath.make(path.isAbsolute(expanded) ? expanded : path.join(location.directory, expanded)),
          }),
        )
      }
    })
    yield* ctx.event.subscribe().pipe(
      Stream.filter((event) => event.type === "config.updated"),
      Stream.runForEach(() =>
        config.entries().pipe(
          Effect.tap((entries) => Effect.sync(() => (loaded.entries = entries))),
          Effect.andThen(ctx.skill.reload()),
        ),
      ),
      Effect.forkScoped({ startImmediately: true }),
    )
  }),
})
