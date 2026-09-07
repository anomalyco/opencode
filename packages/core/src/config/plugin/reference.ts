export * as ConfigReferencePlugin from "./reference.js"

import { define } from "@opencode-ai/plugin/effect/plugin"
import { Document } from "@opencode-ai/schema/config"
import { ConfigReference } from "@opencode-ai/schema/config/reference"
import path from "path"
import { Effect } from "effect"
import { Config } from "../../config.js"
import { Reference } from "../../reference.js"
import { AbsolutePath } from "../../schema.js"
import { Global } from "@opencode-ai/util/global"
import { Location } from "../../location.js"
import { ConfigEntryObserver } from "./entry-observer.js"

export const Plugin = define({
  id: "opencode.config.reference",
  effect: Effect.fn(function* (ctx) {
    const config = yield* Config.Service
    const location = yield* Location.Service
    const global = yield* Global.Service
    const loaded = yield* ConfigEntryObserver.observe(config, ctx.event, ctx.reference.reload())
    yield* ctx.reference.transform((editor) => {
      for (const doc of loaded.entries.filter((entry): entry is Document => entry.type === "document")) {
        const directory = doc.path ? path.dirname(doc.path) : location.directory
        for (const [name, entry] of Object.entries(doc.info.references ?? {})) {
          if (!validAlias(name)) continue
          const description = typeof entry === "string" ? undefined : entry.description
          const hidden = typeof entry === "string" ? undefined : entry.hidden
          editor.add(
            name,
            local(entry)
              ? Reference.LocalSource.make({
                  type: "local",
                  path: AbsolutePath.make(
                    localPath(directory, global.home, typeof entry === "string" ? entry : entry.path),
                  ),
                  ...(description === undefined ? {} : { description }),
                  ...(hidden === undefined ? {} : { hidden }),
                })
              : Reference.GitSource.make({
                  type: "git",
                  repository: typeof entry === "string" ? entry : entry.repository,
                  ...(entry.branch === undefined ? {} : { branch: entry.branch }),
                  ...(description === undefined ? {} : { description }),
                  ...(hidden === undefined ? {} : { hidden }),
                }),
          )
        }
      }
    })
  }),
})

function validAlias(name: string) {
  return name.length > 0 && !/[\/\s`,]/.test(name)
}

function local(entry: ConfigReference.Entry): entry is string | ConfigReference.Local {
  return typeof entry === "string"
    ? entry.startsWith(".") || entry.startsWith("/") || entry.startsWith("~")
    : "path" in entry
}

function localPath(directory: string, home: string, value: string) {
  if (value.startsWith("~/")) return path.join(home, value.slice(2))
  return path.isAbsolute(value) ? value : path.resolve(directory, value)
}
