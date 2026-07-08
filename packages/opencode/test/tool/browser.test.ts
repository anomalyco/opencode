import { afterAll, beforeAll, describe, expect } from "bun:test"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Effect, Layer } from "effect"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { Config } from "@/config/config"
import { BrowserTool } from "../../src/tool/browser"
import { provideInstance, testInstanceStoreLayer } from "../fixture/fixture"
import { Agent } from "../../src/agent/agent"
import { Truncate } from "@/tool/truncate"
import { SessionID, MessageID } from "../../src/session/schema"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { UvBinary } from "@opencode-ai/core/uv"
import { Plugin } from "../../src/plugin"
import { testEffect } from "../lib/effect"
import { RuntimeFlags } from "@/effect/runtime-flags"

// Stub UvBinary so the download tier never hits the network in tests.
const uvBinaryStub = Layer.effect(
  UvBinary.Service,
  Effect.sync(() =>
    UvBinary.Service.of({
      filepath: Effect.sync(() => path.join(uvStubDir, "uv")),
    }),
  ),
)

const browserLayer = Layer.mergeAll(
  LayerNode.compile(
    LayerNode.group([
      CrossSpawnSpawner.node,
      FSUtil.node,
      Plugin.node,
      Truncate.node,
      Config.node,
      Agent.node,
      RuntimeFlags.node,
    ]),
  ),
  uvBinaryStub,
  testInstanceStoreLayer,
)
const it = testEffect(browserLayer)

const ctx = {
  sessionID: SessionID.make("ses_test"),
  messageID: MessageID.make("msg_test"),
  callID: "",
  agent: "build",
  abort: AbortSignal.any([]),
  messages: [],
  metadata: () => Effect.void,
  ask: () => Effect.void,
}

const projectRoot = path.join(__dirname, "../..")

const run = Effect.fn("BrowserToolTest.run")(function* (args: { script: string; timeout?: number }) {
  const info = yield* BrowserTool
  const tool = yield* info.init()
  return yield* tool.execute(args, ctx)
})

// Stub browser-use binary: echoes stdin back, exits nonzero when asked.
let stubDir: string
const originalPath = process.env.PATH

let uvxStubDir: string
let uvStubDir: string

beforeAll(async () => {
  stubDir = await fs.mkdtemp(path.join(os.tmpdir(), "browser-tool-test-"))
  const stub = path.join(stubDir, "browser-use")
  await fs.writeFile(stub, `#!/bin/sh\nscript=$(cat)\nif [ "$script" = "fail" ]; then echo boom; exit 3; fi\nprintf 'RAN:%s' "$script"\n`)
  await fs.chmod(stub, 0o755)

  uvxStubDir = await fs.mkdtemp(path.join(os.tmpdir(), "browser-tool-uvx-test-"))
  const uvx = path.join(uvxStubDir, "uvx")
  await fs.writeFile(uvx, `#!/bin/sh\n[ "$1" = "browser-use" ] || exit 9\nprintf 'UVX:%s' "$(cat)"\n`)
  await fs.chmod(uvx, 0o755)

  uvStubDir = await fs.mkdtemp(path.join(os.tmpdir(), "browser-tool-uv-test-"))
  const uv = path.join(uvStubDir, "uv")
  await fs.writeFile(uv, `#!/bin/sh\n[ "$1" = "tool" ] && [ "$2" = "run" ] && [ "$3" = "browser-use" ] || exit 9\nprintf 'UV:%s' "$(cat)"\n`)
  await fs.chmod(uv, 0o755)

  process.env.PATH = `${stubDir}${path.delimiter}${originalPath}`
})

afterAll(async () => {
  process.env.PATH = originalPath
  await fs.rm(stubDir, { recursive: true, force: true })
  await fs.rm(uvxStubDir, { recursive: true, force: true })
  await fs.rm(uvStubDir, { recursive: true, force: true })
})

describe.skipIf(process.platform === "win32")("tool.browser", () => {
  it.live("pipes the script to browser-use stdin and returns stdout", () =>
    provideInstance(projectRoot)(
      Effect.gen(function* () {
        const result = yield* run({ script: "print(2+2)" })
        expect(result.output).toBe("RAN:print(2+2)")
        expect(Number(result.metadata.exitCode)).toBe(0)
        expect(result.title).toBe("print(2+2)")
      }),
    ),
  )

  it.live("reports a nonzero exit code in the output", () =>
    provideInstance(projectRoot)(
      Effect.gen(function* () {
        const result = yield* run({ script: "fail" })
        expect(Number(result.metadata.exitCode)).toBe(3)
        expect(result.output).toContain("browser-use exited with code 3")
        expect(result.output).toContain("boom")
      }),
    ),
  )

  it.live("falls back to uvx when browser-use is not on PATH", () =>
    provideInstance(projectRoot)(
      Effect.gen(function* () {
        const previous = process.env.PATH
        process.env.PATH = `${uvxStubDir}${path.delimiter}/usr/bin${path.delimiter}/bin`
        try {
          const result = yield* run({ script: "print(1)" })
          expect(result.output).toBe("UVX:print(1)")
        } finally {
          process.env.PATH = previous
        }
      }),
    ),
  )

  it.live("falls back to the provisioned uv when neither browser-use nor uvx is on PATH", () =>
    provideInstance(projectRoot)(
      Effect.gen(function* () {
        const previous = process.env.PATH
        process.env.PATH = `/usr/bin${path.delimiter}/bin`
        try {
          const result = yield* run({ script: "print(2)" })
          expect(result.output).toBe("UV:print(2)")
        } finally {
          process.env.PATH = previous
        }
      }),
    ),
  )
})
