export * as ProjectJj from "./jj.js"

import path from "path"
import { Effect } from "effect"
import { FSUtil } from "@opencode-ai/util/fs-util"
import { AbsolutePath } from "../schema.js"

export const id = "opencode.vcs.jj"
export const vcs = { id: "jj", markers: [".jj"] }

export const discover = Effect.fn("ProjectJj.discover")(function* (fs: FSUtil.Interface, metadata: AbsolutePath) {
  const reference = path.join(metadata, "repo")
  const direct = yield* fs.isDir(reference)
  const pointer = direct ? undefined : yield* fs.readFileString(reference).pipe(Effect.orElseSucceed(() => undefined))
  if (!direct && !pointer?.trim()) return undefined

  const store = yield* fs.realPath(pointer ? path.resolve(metadata, pointer.trim()) : reference).pipe(
    Effect.map((value) => AbsolutePath.make(value)),
    Effect.orElseSucceed(() => undefined),
  )
  if (!store || !(yield* fs.isDir(store))) return undefined

  const directory = yield* fs.realPath(path.dirname(metadata)).pipe(
    Effect.map((value) => AbsolutePath.make(value)),
    Effect.orElseSucceed(() => undefined),
  )
  if (!directory) return undefined

  return { directory, store, canonical: AbsolutePath.make(path.dirname(path.dirname(store))) }
})
