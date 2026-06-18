import path from "path"
import fs from "fs/promises"
import { expect, test } from "bun:test"
import { Effect, Layer } from "effect"
import { Config } from "@opencode-ai/core/config"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { Global } from "@opencode-ai/core/global"
import { Location } from "@opencode-ai/core/location"
import { Policy } from "@opencode-ai/core/policy"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { location } from "./fixture/location"
import { tmpdir } from "./fixture/tmpdir"

function testLayer(directory: string) {
  return Config.locationLayer.pipe(
    Layer.provide(FSUtil.defaultLayer),
    Layer.provide(Global.layerWith({ config: path.join(directory, "global") })),
    Layer.provide(
      Layer.succeed(
        Location.Service,
        Location.Service.of(
          location(
            { directory: AbsolutePath.make(directory) },
            { projectDirectory: AbsolutePath.make(directory) },
          ),
        ),
      ),
    ),
  )
}

test("applies compaction disable env flags as highest-priority overrides", async () => {
  const tmp = await tmpdir()
  const previous = {
    OPENCODE_DISABLE_AUTOCOMPACT: process.env.OPENCODE_DISABLE_AUTOCOMPACT,
    OPENCODE_DISABLE_PRUNE: process.env.OPENCODE_DISABLE_PRUNE,
  }
  process.env.OPENCODE_DISABLE_AUTOCOMPACT = "true"
  process.env.OPENCODE_DISABLE_PRUNE = "true"

  try {
    await fs.writeFile(path.join(tmp.path, "opencode.json"), JSON.stringify({ compaction: { auto: true, prune: true } }))

    const documents = await Effect.runPromise(
      Config.Service.pipe(
        Effect.flatMap((config) => config.entries()),
        Effect.map((entries) => entries.filter((entry) => entry.type === "document")),
        Effect.provide(testLayer(tmp.path)),
      ),
    )

    expect(documents.at(-1)?.info.compaction).toMatchObject({ auto: false, prune: false })
  } finally {
    if (previous.OPENCODE_DISABLE_AUTOCOMPACT === undefined) delete process.env.OPENCODE_DISABLE_AUTOCOMPACT
    else process.env.OPENCODE_DISABLE_AUTOCOMPACT = previous.OPENCODE_DISABLE_AUTOCOMPACT
    if (previous.OPENCODE_DISABLE_PRUNE === undefined) delete process.env.OPENCODE_DISABLE_PRUNE
    else process.env.OPENCODE_DISABLE_PRUNE = previous.OPENCODE_DISABLE_PRUNE
    await tmp[Symbol.asyncDispose]()
  }
})
