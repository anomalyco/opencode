import { afterEach, describe, expect } from "bun:test"
import path from "path"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Effect, Layer } from "effect"
import { decode, encode } from "iconv-lite"
import { EditTool } from "../../src/tool/edit"
import { ReadTool } from "../../src/tool/read"
import { WriteTool } from "../../src/tool/write"
import { disposeAllInstances, TestInstance, testInstanceStoreLayer } from "../fixture/fixture"
import { LSP } from "@/lsp/lsp"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { Format } from "../../src/format"
import { Agent } from "../../src/agent/agent"
import { EventV2Bridge } from "../../src/event-v2-bridge"
import { Truncate } from "@/tool/truncate"
import { Instruction } from "../../src/session/instruction"
import { SessionID, MessageID } from "../../src/session/schema"
import * as Tool from "../../src/tool/tool"
import { Config } from "@/config/config"
import { Encoding } from "../../src/util/encoding"
import { testEffect } from "../lib/effect"

const ctx = {
  sessionID: SessionID.make("ses_test-encoding-session"),
  messageID: MessageID.make("msg_test"),
  callID: "",
  agent: "build",
  abort: AbortSignal.any([]),
  messages: [],
  metadata: () => Effect.void,
  ask: () => Effect.void,
}

afterEach(async () => {
  await disposeAllInstances()
})

const layer = Layer.mergeAll(
  LayerNode.compile(
    LayerNode.group([
      LSP.node,
      FSUtil.node,
      Format.node,
      EventV2Bridge.node,
      Truncate.node,
      Agent.node,
      Instruction.node,
      Config.node,
    ]),
  ),
  testInstanceStoreLayer,
)

const it = testEffect(layer)

const runEdit = Effect.fn("EncodingTest.runEdit")(function* (args: Tool.InferParameters<typeof EditTool>) {
  const info = yield* EditTool
  const tool = yield* info.init()
  return yield* tool.execute(args, ctx)
})

const runWrite = Effect.fn("EncodingTest.runWrite")(function* (args: Tool.InferParameters<typeof WriteTool>) {
  const info = yield* WriteTool
  const tool = yield* info.init()
  return yield* tool.execute(args, ctx)
})

const runRead = Effect.fn("EncodingTest.runRead")(function* (args: Tool.InferParameters<typeof ReadTool>) {
  const info = yield* ReadTool
  const tool = yield* info.init()
  return yield* tool.execute(args, ctx)
})

const putBytes = Effect.fn("EncodingTest.putBytes")(function* (p: string, content: Uint8Array) {
  const fs = yield* FSUtil.Service
  yield* fs.writeWithDirs(p, content)
})

const loadBytes = Effect.fn("EncodingTest.loadBytes")(function* (p: string) {
  const fs = yield* FSUtil.Service
  return yield* fs.readFile(p)
})

describe("util.encoding", () => {
  describe("detect", () => {
    it.effect("detects utf-8 BOM", () =>
      Effect.sync(() => {
        const bytes = encode("\ufeffhello", "utf-8")
        expect(Encoding.detect(bytes)).toEqual({ encoding: "utf-8", bom: true })
      }),
    )

    it.effect("detects utf-16le and utf-16be BOMs", () =>
      Effect.sync(() => {
        expect(Encoding.detect(new Uint8Array([0xff, 0xfe, 0x61, 0x00]))).toEqual({
          encoding: "utf-16le",
          bom: true,
        })
        expect(Encoding.detect(new Uint8Array([0xfe, 0xff, 0x00, 0x61]))).toEqual({
          encoding: "utf-16be",
          bom: true,
        })
      }),
    )

    it.effect("detects valid utf-8 without BOM", () =>
      Effect.sync(() => {
        expect(Encoding.detect(encode("你好 utf-8", "utf-8"))).toEqual({ encoding: "utf-8", bom: false })
        expect(Encoding.detect(new Uint8Array([0x61, 0x62]))).toEqual({ encoding: "utf-8", bom: false })
      }),
    )

    it.effect("falls back to the configured encoding for non utf-8 bytes", () =>
      Effect.sync(() => {
        const gbk = encode("你好世界", "gbk")
        expect(Encoding.detect(gbk, "gbk")).toEqual({ encoding: "gbk", bom: false })
        expect(Encoding.detect(gbk)).toEqual({ encoding: "utf-8", bom: false })
      }),
    )

    it.effect("treats a multi byte sequence cut at the sample edge as utf-8", () =>
      Effect.sync(() => {
        const full = encode("你好世界", "utf-8")
        const cut = full.slice(0, full.length - 1)
        expect(Encoding.detect(cut)).toEqual({ encoding: "utf-8", bom: false })
      }),
    )
  })
})

describe("tool encoding", () => {
  it.instance(
    "edits a GBK file in place without corrupting it",
    () =>
      Effect.gen(function* () {
        const test = yield* TestInstance
        const filepath = path.join(test.directory, "gbk.txt")
        yield* putBytes(filepath, encode("function greet() {\n  你好世界\n}\n", "gbk"))

        yield* runEdit({ filePath: filepath, oldString: "你好世界", newString: "再见世界" })

        const bytes = yield* loadBytes(filepath)
        expect(decode(bytes, "gbk")).toBe("function greet() {\n  再见世界\n}\n")
      }),
    { config: { file_encoding: "gbk" } },
  )

  it.instance(
    "leaves a non utf-8 file byte identical when the edit does not match",
    () =>
      Effect.gen(function* () {
        const test = yield* TestInstance
        const filepath = path.join(test.directory, "gbk.txt")
        const original = encode("你好世界\n", "gbk")
        yield* putBytes(filepath, original)

        const result = yield* runEdit({ filePath: filepath, oldString: "你好世界", newString: "再见世界" }).pipe(
          Effect.exit,
        )
        expect(result._tag).toBe("Failure")

        const bytes = yield* loadBytes(filepath)
        expect(Buffer.compare(Buffer.from(bytes), original)).toBe(0)
      }),
  )

  it.instance(
    "writes new files in the configured fallback encoding",
    () =>
      Effect.gen(function* () {
        const test = yield* TestInstance
        const filepath = path.join(test.directory, "new-gbk.txt")

        yield* runWrite({ filePath: filepath, content: "中文内容\n" })

        const bytes = yield* loadBytes(filepath)
        expect(decode(bytes, "gbk")).toBe("中文内容\n")
      }),
    { config: { file_encoding: "gbk" } },
  )

  it.instance(
    "reads a GBK file with the configured fallback encoding",
    () =>
      Effect.gen(function* () {
        const test = yield* TestInstance
        const filepath = path.join(test.directory, "gbk.txt")
        yield* putBytes(filepath, encode("第一行\n第二行\n", "gbk"))

        const result = yield* runRead({ filePath: filepath })

        expect(result.output).toContain("第一行")
        expect(result.output).toContain("第二行")
      }),
    { config: { file_encoding: "gbk" } },
  )

  it.instance("edits a utf-16le file with BOM in place", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      const filepath = path.join(test.directory, "utf16le.txt")
      yield* putBytes(filepath, Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from("你好世界\n", "utf16le")]))

      yield* runEdit({ filePath: filepath, oldString: "你好世界", newString: "再见世界" })

      const bytes = yield* loadBytes(filepath)
      expect(bytes[0]).toBe(0xff)
      expect(bytes[1]).toBe(0xfe)
      expect(Buffer.from(bytes.slice(2)).toString("utf16le")).toBe("再见世界\n")
    }),
  )

  it.instance("edits a utf-16be file with BOM in place", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      const filepath = path.join(test.directory, "utf16be.txt")
      yield* putBytes(filepath, Buffer.concat([Buffer.from([0xfe, 0xff]), Buffer.from("你好世界\n", "utf16le").swap16()]))

      yield* runEdit({ filePath: filepath, oldString: "你好世界", newString: "再见世界" })

      const bytes = yield* loadBytes(filepath)
      expect(bytes[0]).toBe(0xfe)
      expect(bytes[1]).toBe(0xff)
      expect(Buffer.from(bytes.slice(2)).swap16().toString("utf16le")).toBe("再见世界\n")
    }),
  )

  it.instance("keeps plain utf-8 files utf-8 by default", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      const filepath = path.join(test.directory, "utf8.txt")
      yield* putBytes(filepath, encode("你好世界\n", "utf-8"))

      yield* runEdit({ filePath: filepath, oldString: "你好世界", newString: "再见世界" })

      const bytes = yield* loadBytes(filepath)
      expect(decode(bytes, "utf-8")).toBe("再见世界\n")
    }),
  )

  it.instance("preserves utf-8 BOM across edits", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      const filepath = path.join(test.directory, "bom.txt")
      yield* putBytes(filepath, encode("\ufeff你好世界\n", "utf-8"))

      yield* runEdit({ filePath: filepath, oldString: "你好世界", newString: "再见世界" })

      const bytes = yield* loadBytes(filepath)
      expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf])
      expect(decode(bytes, "utf-8", { stripBOM: false })).toBe("\ufeff再见世界\n")
    }),
  )
})
