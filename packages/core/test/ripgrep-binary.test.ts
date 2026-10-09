import { describe, expect } from "bun:test"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { Effect, Layer } from "effect"
import { HttpClient, HttpClientResponse } from "effect/unstable/http"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { RipgrepBinary } from "@opencode/core/ripgrep/binary"
import { LayerNodePlatform } from "@opencode/util/effect/app-node-platform"
import { Global } from "@opencode/util/global"
import { testEffect } from "./lib/effect"

const testRoot = path.join(os.tmpdir(), `opencode-ripgrep-test-${process.pid}-${Date.now()}`)
const testBin = path.join(testRoot, "bin")
const globalLayer = Global.layerWith({
  home: testRoot,
  data: path.join(testRoot, "data"),
  cache: path.join(testRoot, "cache"),
  config: path.join(testRoot, "config"),
  state: path.join(testRoot, "state"),
  tmp: path.join(testRoot, "tmp"),
  bin: testBin,
  log: path.join(testRoot, "log"),
  repos: path.join(testRoot, "repos"),
})

const failingHttp = HttpClient.make((request) =>
  Effect.succeed(HttpClientResponse.fromWeb(request, new Response("download failed", { status: 503 }))),
)

const layer = Layer.fresh(
  AppNodeBuilder.build(RipgrepBinary.node, [
    Global.node.replace(globalLayer),
    LayerNodePlatform.httpClient.replace(Layer.succeed(HttpClient.HttpClient, failingHttp)),
  ]),
)

const it = testEffect(layer)

describe("RipgrepBinary", () => {
  it.live("retries resolution after a failed download", () =>
    Effect.gen(function* () {
      const previousPath = process.env.PATH
      process.env.PATH = ""
      try {
        const binary = yield* RipgrepBinary.Service
        yield* Effect.flip(binary.filepath)

        const target = path.join(testBin, process.platform === "win32" ? "rg.exe" : "rg")
        yield* Effect.promise(() => fs.mkdir(testBin, { recursive: true }))
        yield* Effect.promise(() => fs.writeFile(target, "preloaded"))

        expect(yield* binary.filepath).toBe(target)
      } finally {
        process.env.PATH = previousPath
        yield* Effect.promise(() => fs.rm(testRoot, { recursive: true, force: true }))
      }
    }),
  )
})
