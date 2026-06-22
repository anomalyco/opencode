export * as ConfigSkillPlugin from "./skill"

import { define } from "../../plugin/internal"
import path from "path"
import { Effect } from "effect"
import { Config } from "../../config"
import { AbsolutePath } from "../../schema"
import { SkillV2 } from "../../skill"
import { Global } from "../../global"
import { Location } from "../../location"

export const Plugin = define({
  id: "config-skill",
  effect: Effect.fn(function* (ctx) {
    const config = yield* Config.Service
    const global = yield* Global.Service
    const location = yield* Location.Service
    yield* ctx.skill.transform(
      Effect.fn(function* (draft) {
        const entries = yield* config.entries()
        const directories = entries.flatMap((entry) => (entry.type === "directory" ? [entry.path] : []))
        const items = entries.flatMap((entry) => (entry.type === "document" ? (entry.info.skills ?? []) : []))
        for (const directory of directories) {
          draft.source(
            new SkillV2.DirectorySource({ type: "directory", path: AbsolutePath.make(path.join(directory, "skill")) }),
          )
          draft.source(
            new SkillV2.DirectorySource({ type: "directory", path: AbsolutePath.make(path.join(directory, "skills")) }),
          )
        }
        for (const item of items) {
          if (URL.canParse(item) && /^(https?:)$/.test(new URL(item).protocol)) {
            draft.source(new SkillV2.UrlSource({ type: "url", url: item }))
            continue
          }
          const expanded = item.startsWith("~/") ? path.join(global.home, item.slice(2)) : item
          draft.source(
            new SkillV2.DirectorySource({
              type: "directory",
              path: AbsolutePath.make(path.isAbsolute(expanded) ? expanded : path.join(location.directory, expanded)),
            }),
          )
        }
      }),
    )
  }),
})
