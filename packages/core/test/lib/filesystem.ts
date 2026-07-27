import { Effect } from "effect"
import { FSUtil } from "@opencode-ai/util/fs-util"

/** Creates a canonical temporary directory removed with the current Scope. */
export const tempDirectory = Effect.gen(function* () {
  const fs = yield* FSUtil.Service
  const temporary = yield* fs.makeTempDirectoryScoped({ prefix: "opencode-core-test-" })
  return { fs, path: yield* fs.realPath(temporary) }
})
