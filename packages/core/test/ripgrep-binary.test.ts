import { describe, expect } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { Effect, Exit, Layer } from "effect"
import { HttpClient, HttpClientResponse } from "effect/http"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { RipgrepBinary } from "@opencode/core/ripgrep/binary"
import { LayerNodePlatform } from "@opencode/util/effect/app-node-platform"
import { Global } from "@opencode/util/global"
import { withEnv } from "./fixture/env"
import { withTempDir } from "./fixture/tmpdir"
import { it } from "./lib/effect"

// A typed HTTP failure and a defect thrown inside the resolver must both leave the next call free to retry.
const failures = [
  { name: "a failed download", response: () => new Response("unavailable", { status: 503 }) },
  { name: "an empty download", response: () => new Response(new Uint8Array(), { status: 200 }) },
]

describe("RipgrepBinary", () => {
  for (const failure of failures) {
    it.live(`retries resolution after ${failure.name}`, () =>
      withTempDir((tmp) =>
        withEnv({ PATH: "" }, () =>
          Effect.gen(function* () {
            const bin = path.join(tmp.path, "bin")
            const binary = yield* RipgrepBinary.Service
            expect(Exit.isFailure(yield* Effect.exit(binary.filepath))).toBe(true)

            const target = path.join(bin, process.platform === "win32" ? "rg.exe" : "rg")
            yield* Effect.promise(() => fs.mkdir(bin, { recursive: true }))
            yield* Effect.promise(() => fs.writeFile(target, ""))

            expect(yield* binary.filepath).toBe(target)
          }).pipe(
            Effect.provide(
              AppNodeBuilder.build(RipgrepBinary.node, [
                Global.node.replace(
                  Global.layerWith({
                    home: tmp.path,
                    cache: path.join(tmp.path, "cache"),
                    bin: path.join(tmp.path, "bin"),
                  }),
                ),
                LayerNodePlatform.httpClient.replace(
                  Layer.succeed(
                    HttpClient.HttpClient,
                    HttpClient.make((request) =>
                      Effect.succeed(HttpClientResponse.fromWeb(request, failure.response())),
                    ),
                  ),
                ),
              ]),
            ),
          ),
        ),
      ),
    )
  }
})
