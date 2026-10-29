import fs from "fs/promises"
import path from "path"
import { describe, expect } from "bun:test"
import { decode, encode } from "iconv-lite"
import { Effect, Layer, Result } from "effect"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { makeLocationNode } from "@opencode/util/effect/app-node"
import { Encoding } from "@opencode/core/encoding"
import { Environment } from "@opencode/core/environment/index"
import { Formatter } from "@opencode/core/formatter"
import { FileMutation } from "@opencode/core/file-mutation"
import { Location } from "@opencode/core/location"
import { FileAccess } from "@opencode/core/file-access"
import { Permission } from "@opencode/core/permission"
import { AbsolutePath } from "@opencode/core/schema"
import { Session } from "@opencode/core/session"
import { Tool } from "@opencode/core/tool"
import { EditTool } from "@opencode/core/tool/plugin/edit"
import { WriteTool } from "@opencode/core/tool/plugin/write"
import { PatchTool } from "@opencode/core/tool/plugin/patch"
import { ReadToolFileSystem } from "@opencode/core/tool/read-filesystem"
import { transformEnvironmentFiles } from "./fixture/environment"
import { location } from "./fixture/location"
import { withTempDir } from "./fixture/tmpdir"
import { testEffect } from "./lib/effect"
import { permissionLayer } from "./lib/permission"
import { toolIdentity, executeTool, registerToolPlugin } from "./lib/tool"

const sessionID = Session.ID.make("ses_encoding_tool_test")

const toolDeps = [
  Tool.node,
  FileAccess.node,
  FileMutation.node,
  Environment.node,
  Formatter.node,
  Location.node,
  Permission.node,
] as const

const editNode = makeLocationNode({
  name: "test/encoding-edit",
  layer: Layer.effectDiscard(registerToolPlugin(EditTool.Plugin)),
  deps: toolDeps,
})
const writeNode = makeLocationNode({
  name: "test/encoding-write",
  layer: Layer.effectDiscard(registerToolPlugin(WriteTool.Plugin)),
  deps: toolDeps,
})
const patchNode = makeLocationNode({
  name: "test/encoding-patch",
  layer: Layer.effectDiscard(registerToolPlugin(PatchTool.Plugin)),
  deps: toolDeps,
})

const withTools = <A, E, R>(
  directory: string,
  body: (registry: Tool.Interface) => Effect.Effect<A, E, R>,
) => {
  const activeLocation = Layer.succeed(
    Location.Service,
    Location.Service.of(location({ directory: AbsolutePath.make(directory) })),
  )
  return Effect.gen(function* () {
    const registry = yield* Tool.Service
    return yield* body(registry)
  }).pipe(
    Effect.provide(
      AppNodeBuilder.build(
        LayerNode.group([
          Tool.node,
          FileAccess.node,
          FileMutation.node,
          Environment.node,
          editNode,
          writeNode,
          patchNode,
        ]),
        [
          Environment.node.replace(transformEnvironmentFiles(() => ({}))),
          Location.node.replace(activeLocation),
          Formatter.node.replace(Layer.mock(Formatter.Service, { file: () => Effect.succeed(false) })),
          Permission.node.replace(permissionLayer({ assert: () => Effect.void })),
        ],
      ),
    ),
  )
}

const call = (name: string, input: unknown, id: string) => ({
  sessionID,
  ...toolIdentity,
  call: { type: "tool-call" as const, id, name, input },
})

const it = testEffect(Layer.empty)

const errorMessage = (settled: { readonly status: string; readonly error?: unknown }) =>
  settled.status === "error" ? JSON.stringify(settled.error) : ""

describe("Encoding", () => {
  it.live("detects BOM-marked and UTF-8 files", () =>
    Effect.gen(function* () {
      expect(yield* Encoding.detect(new TextEncoder().encode("hello world\n"))).toEqual({
        encoding: "utf-8",
        bom: false,
        valid: true,
      })
      expect(yield* Encoding.detect(new Uint8Array([0xef, 0xbb, 0xbf, 0x68, 0x69]))).toEqual({
        encoding: "utf-8",
        bom: true,
        valid: true,
      })
      const utf16 = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from("你好\n", "utf16le")])
      const source = yield* Encoding.detect(utf16)
      expect(source).toEqual({ encoding: "utf-16le", bom: true, valid: true })
      expect(yield* Encoding.decodeText(utf16, source)).toBe("你好\n")
    }),
  )

  it.live("detects GBK bytes as gb18030 and round-trips them", () =>
    Effect.gen(function* () {
      const original = "function greet() {\n  你好世界\n}\n"
      const bytes = encode(original, "gbk")
      const source = yield* Encoding.detect(bytes)
      expect(source.encoding).toBe("gb18030")
      expect(source.valid).toBe(true)
      expect(yield* Encoding.decodeText(bytes, source)).toBe(original)
      expect(Buffer.from(yield* Encoding.encodeText(original, source)).equals(Buffer.from(bytes))).toBe(true)
    }),
  )

  // A lossless round-trip cannot separate the overlapping CJK byte ranges, so
  // detection leans on the statistical guess; each variant must come back as
  // itself rather than collapsing into gb18030.
  it.live("tells big5, shift_jis, and euc-kr apart", () =>
    Effect.gen(function* () {
      const samples: Array<[string, string]> = [
        ["big5", "function 設定() {\n  繁體中文測試，設定檔案處理\n}\n"],
        ["shift_jis", "function 設定() {\n  日本語テスト、設定ファイル\n}\n"],
        ["euc-kr", "function config() {\n  한국어 테스트 파일 설정\n}\n"],
      ]
      for (const [encoding, text] of samples) {
        const bytes = encode(text, encoding)
        const source = yield* Encoding.detect(bytes)
        expect(source.encoding).toBe(encoding)
        expect(source.valid).toBe(true)
        expect(yield* Encoding.decodeText(bytes, source)).toBe(text)
        expect(Buffer.from(yield* Encoding.encodeText(text, source)).equals(Buffer.from(bytes))).toBe(true)
      }
    }),
  )

  // The Latin single-byte code pages are mutually indistinguishable, so any
  // western label collapses onto windows-1252; labels naming a
  // language-specific code page are refused rather than read or written
  // through a wrong code page.
  it.live("collapses western single-byte labels onto windows-1252 and refuses the rest", () =>
    Effect.gen(function* () {
      const western = encode("Résumé: café naïve façade über straße", "windows-1252")
      expect(yield* Encoding.detect(western)).toEqual({ encoding: "windows-1252", bom: false, valid: true })
      expect(yield* Encoding.decodeText(western, yield* Encoding.detect(western))).toBe(
        "Résumé: café naïve façade über straße",
      )
      // Mostly-ASCII text with a single high byte is labeled cp852 by jschardet.
      const sparse = encode("The quick brown fox — it works!", "windows-1252")
      expect((yield* Encoding.detect(sparse)).encoding).toBe("windows-1252")
      expect(yield* Encoding.detect(encode("Привет мир, тестирование кодировки", "windows-1251"))).toEqual({
        encoding: "utf-8",
        bom: false,
        valid: false,
      })
      // Turkish letters named by the label would decode as wrong Latin letters.
      expect(yield* Encoding.detect(encode("şehir, ığdır, İstanbul", "windows-1254"))).toEqual({
        encoding: "utf-8",
        bom: false,
        valid: false,
      })
    }),
  )

  it.live("marks a dangling trailing lead byte invalid for whole-file detection", () =>
    Effect.gen(function* () {
      const bytes = Buffer.concat([encode("function greet() {\n  你好世界\n}\n", "gbk"), Buffer.from([0x81])])
      expect(yield* Encoding.detect(bytes)).toEqual({ encoding: "utf-8", bom: false, valid: false })
      // A sampled prefix tolerates the truncated tail and still reads.
      expect((yield* Encoding.detect(bytes, { sample: true })).encoding).toBe("gb18030")
    }),
  )

  // Whole-file detection must not retry UTF-8 validity without trailing
  // bytes, or legacy bytes that only look UTF-8-ish after dropping the tail
  // decode with replacement characters that the next edit writes back.
  it.live("does not accept whole files as UTF-8 via trailing-byte retries", () =>
    Effect.gen(function* () {
      const gbk = yield* Encoding.detect(encode("注释\n", "gbk"))
      expect(gbk.encoding).toBe("gb18030")
      expect(gbk.valid).toBe(true)
      expect(yield* Encoding.decodeText(encode("注释\n", "gbk"), gbk)).toBe("注释\n")
      const cafe = yield* Encoding.detect(encode("café\n", "windows-1252"))
      expect(cafe.encoding).toBe("windows-1252")
      expect(cafe.valid).toBe(true)
      // A genuinely truncated sample still tolerates the cut tail.
      expect((yield* Encoding.detect(encode("café\n", "windows-1252"), { sample: true })).encoding).toBe("utf-8")
    }),
  )

  it.live("fails encoding when content is not representable", () =>
    Effect.gen(function* () {
      const source = yield* Encoding.detect(encode("function 設定() {\n  日本語テスト\n}\n", "shift_jis"))
      const result = yield* Effect.flip(Encoding.encodeText("日本語テスト😀\n", source))
      expect(result).toBeInstanceOf(Encoding.UnrepresentableError)
      expect(result.message).toContain("shift_jis")
    }),
  )

  it.live("marks undecodable bytes as invalid", () =>
    Effect.gen(function* () {
      const junk = Uint8Array.from({ length: 64 }, (_, index) => (index % 2 === 0 ? 0x81 : 0xff))
      const source = yield* Encoding.detect(junk)
      expect(source.encoding).toBe("utf-8")
      expect(source.valid).toBe(false)
    }),
  )

  it.live("keeps a UTF-8 BOM through decode and encode", () =>
    Effect.gen(function* () {
      const bytes = new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode("hi\n")])
      const source = yield* Encoding.detect(bytes)
      const text = yield* Encoding.decodeText(bytes, source)
      expect(text.charCodeAt(0)).toBe(0xfeff)
      expect(Buffer.from(yield* Encoding.encodeText(text, source)).equals(Buffer.from(bytes))).toBe(true)
    }),
  )
})

describe("tool encoding", () => {
  it.live("edits a GBK file in place without configuration", () =>
    withTempDir((tmp) => {
      const target = path.join(tmp.path, "gbk.txt")
      const original = encode("function greet() {\n  你好世界\n}\n", "gbk")
      return Effect.promise(() => fs.writeFile(target, original)).pipe(
        Effect.andThen(
          withTools(tmp.path, (registry) =>
            executeTool(
              registry,
              call("edit", { path: "gbk.txt", oldString: "你好世界", newString: "再见世界" }, "call-encoding-edit"),
            ),
          ),
        ),
        Effect.andThen((settled) =>
          Effect.gen(function* () {
            expect(settled.status).toBe("completed")
            const bytes = yield* Effect.promise(() => fs.readFile(target))
            expect(decode(bytes, "gbk")).toBe("function greet() {\n  再见世界\n}\n")
          }),
        ),
      )
    }),
  )

  it.live("refuses to edit a file whose encoding cannot be identified", () =>
    withTempDir((tmp) => {
      const target = path.join(tmp.path, "junk.txt")
      const junk = Uint8Array.from({ length: 64 }, (_, index) => (index % 2 === 0 ? 0x81 : 0xff))
      return Effect.promise(() => fs.writeFile(target, junk)).pipe(
        Effect.andThen(
          withTools(tmp.path, (registry) =>
            executeTool(
              registry,
              call("edit", { path: "junk.txt", oldString: "a", newString: "b" }, "call-encoding-junk"),
            ),
          ),
        ),
        Effect.andThen((settled) =>
          Effect.gen(function* () {
            expect(settled.status).toBe("error")
            expect(errorMessage(settled)).toContain("encoding")
            expect(Buffer.from(yield* Effect.promise(() => fs.readFile(target)))).toEqual(Buffer.from(junk))
          }),
        ),
      )
    }),
  )

  it.live("edits a big5 file and a shift_jis file in place without configuration", () =>
    withTempDir((tmp) => {
      const big5 = path.join(tmp.path, "big5.txt")
      const sjis = path.join(tmp.path, "sjis.txt")
      return Effect.promise(() =>
        Promise.all([
          fs.writeFile(big5, encode("function 設定() {\n  繁體中文測試，設定檔案處理\n}\n", "big5")),
          fs.writeFile(sjis, encode("function 設定() {\n  日本語テスト、設定ファイル\n}\n", "shift_jis")),
        ]),
      ).pipe(
        Effect.andThen(
          withTools(tmp.path, (registry) =>
            Effect.gen(function* () {
              const big5Edit = yield* executeTool(
                registry,
                call("edit", { path: "big5.txt", oldString: "繁體中文測試", newString: "繁體中文修改" }, "call-b5-edit"),
              )
              expect(big5Edit.status).toBe("completed")
              const sjisEdit = yield* executeTool(
                registry,
                call("edit", { path: "sjis.txt", oldString: "日本語テスト", newString: "日本語修正" }, "call-sjis-edit"),
              )
              expect(sjisEdit.status).toBe("completed")
            }),
          ),
        ),
        Effect.andThen(() =>
          Effect.gen(function* () {
            expect(decode(yield* Effect.promise(() => fs.readFile(big5)), "big5")).toBe(
              "function 設定() {\n  繁體中文修改，設定檔案處理\n}\n",
            )
            expect(decode(yield* Effect.promise(() => fs.readFile(sjis)), "shift_jis")).toBe(
              "function 設定() {\n  日本語修正、設定ファイル\n}\n",
            )
          }),
        ),
      )
    }),
  )

  it.live("refuses to add characters the file encoding cannot represent", () =>
    withTempDir((tmp) => {
      const target = path.join(tmp.path, "sjis.txt")
      const original = encode("function 設定() {\n  日本語テスト\n}\n", "shift_jis")
      return Effect.promise(() => fs.writeFile(target, original)).pipe(
        Effect.andThen(
          withTools(tmp.path, (registry) =>
            executeTool(
              registry,
              call("edit", { path: "sjis.txt", oldString: "日本語テスト", newString: "日本語テスト😀" }, "call-sjis-emoji"),
            ),
          ),
        ),
        Effect.andThen((settled) =>
          Effect.gen(function* () {
            expect(settled.status).toBe("error")
            expect(errorMessage(settled)).toContain("cannot be written in shift_jis")
            expect(Buffer.from(yield* Effect.promise(() => fs.readFile(target))).equals(original)).toBe(true)
          }),
        ),
      )
    }),
  )

  it.live("refuses to edit a file with a dangling trailing lead byte", () =>
    withTempDir((tmp) => {
      const target = path.join(tmp.path, "dangling.txt")
      const original = Buffer.concat([encode("function greet() {\n  你好世界\n}\n", "gbk"), Buffer.from([0x81])])
      return Effect.promise(() => fs.writeFile(target, original)).pipe(
        Effect.andThen(
          withTools(tmp.path, (registry) =>
            executeTool(
              registry,
              call("edit", { path: "dangling.txt", oldString: "你好世界", newString: "再见世界" }, "call-dangling"),
            ),
          ),
        ),
        Effect.andThen((settled) =>
          Effect.gen(function* () {
            expect(settled.status).toBe("error")
            expect(errorMessage(settled)).toContain("encoding")
            expect(Buffer.from(yield* Effect.promise(() => fs.readFile(target))).equals(original)).toBe(true)
          }),
        ),
      )
    }),
  )

  it.live("edits a utf-16le file with BOM in place", () =>
    withTempDir((tmp) => {
      const target = path.join(tmp.path, "utf16le.txt")
      const bytes = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from("你好世界\n", "utf16le")])
      return Effect.promise(() => fs.writeFile(target, bytes)).pipe(
        Effect.andThen(
          withTools(tmp.path, (registry) =>
            executeTool(
              registry,
              call("edit", { path: "utf16le.txt", oldString: "你好世界", newString: "再见世界" }, "call-encoding-u16"),
            ),
          ),
        ),
        Effect.andThen((settled) =>
          Effect.gen(function* () {
            expect(settled.status).toBe("completed")
            const written = yield* Effect.promise(() => fs.readFile(target))
            expect([...written.slice(0, 2)]).toEqual([0xff, 0xfe])
            expect(Buffer.from(written.slice(2)).toString("utf16le")).toBe("再见世界\n")
          }),
        ),
      )
    }),
  )

  it.live("writes an existing GBK file back as GBK and creates new files as UTF-8", () =>
    withTempDir((tmp) => {
      const existing = path.join(tmp.path, "existing.txt")
      const created = path.join(tmp.path, "created.txt")
      return Effect.promise(() => fs.writeFile(existing, encode("旧内容\n", "gbk"))).pipe(
        Effect.andThen(
          withTools(tmp.path, (registry) =>
            Effect.gen(function* () {
              expect(
                (
                  yield* executeTool(
                    registry,
                    call("write", { path: "existing.txt", content: "新内容\n" }, "call-encoding-write"),
                  )
                ).status,
              ).toBe("completed")
              expect(decode(yield* Effect.promise(() => fs.readFile(existing)), "gbk")).toBe("新内容\n")
              expect(
                (
                  yield* executeTool(
                    registry,
                    call("write", { path: "created.txt", content: "created\n" }, "call-encoding-create"),
                  )
                ).status,
              ).toBe("completed")
              expect(yield* Effect.promise(() => fs.readFile(created, "utf8"))).toBe("created\n")
            }),
          ),
        ),
      )
    }),
  )

  it.live("patches a GBK file in place", () =>
    withTempDir((tmp) => {
      const target = path.join(tmp.path, "gbk.txt")
      return Effect.promise(() => fs.writeFile(target, encode("第一行\n第二行\n", "gbk"))).pipe(
        Effect.andThen(
          withTools(tmp.path, (registry) =>
            executeTool(
              registry,
              call(
                "patch",
                {
                  patchText: "*** Begin Patch\n*** Update File: gbk.txt\n@@\n-第二行\n+第二行改\n*** End Patch",
                },
                "call-encoding-patch",
              ),
            ),
          ),
        ),
        Effect.andThen((settled) =>
          Effect.gen(function* () {
            expect(settled.status).toBe("completed")
            expect(decode(yield* Effect.promise(() => fs.readFile(target)), "gbk")).toBe("第一行\n第二行改\n")
          }),
        ),
      )
    }),
  )

  it.live("decodes a GBK file through the filesystem reader", () =>
    withTempDir((tmp) => {
      const target = path.join(tmp.path, "gbk.txt")
      return Effect.promise(() => fs.writeFile(target, encode("第一行\n第二行\n第三行\n", "gbk"))).pipe(
        Effect.andThen(
          withTools(tmp.path, () =>
            Effect.gen(function* () {
              const environment = yield* Environment.Service
              const absolute = AbsolutePath.make(yield* Effect.promise(() => fs.realpath(target)))
              const paged = yield* ReadToolFileSystem.read(environment.files, absolute, "gbk.txt", {
                offset: 2,
                limit: 1,
              })
              expect(paged.type).toBe("text-page")
              if (paged.type !== "text-page") return
              expect(paged.content).toBe("第二行")
              expect(paged.next).toBe(3)
              // A small whole-file read returns the shared file-content shape.
              const whole = yield* ReadToolFileSystem.read(environment.files, absolute, "gbk.txt")
              expect(whole.type).toBe("file")
              if (whole.type !== "file" || whole.encoding !== "utf8") return
              expect(whole.content).toContain("第一行")
              expect(whole.content).toContain("第三行")
            }),
          ),
        ),
      )
    }),
  )

  it.live("pages a utf-16le file with BOM through the filesystem reader", () =>
    withTempDir((tmp) => {
      const target = path.join(tmp.path, "utf16le.txt")
      const bytes = Buffer.concat([
        Buffer.from([0xff, 0xfe]),
        Buffer.from("第一行\n第二行\n第三行\n", "utf16le"),
      ])
      return Effect.promise(() => fs.writeFile(target, bytes)).pipe(
        Effect.andThen(
          withTools(tmp.path, () =>
            Effect.gen(function* () {
              const environment = yield* Environment.Service
              const absolute = AbsolutePath.make(yield* Effect.promise(() => fs.realpath(target)))
              const paged = yield* ReadToolFileSystem.read(environment.files, absolute, "utf16le.txt", {
                offset: 2,
                limit: 1,
              })
              expect(paged.type).toBe("text-page")
              if (paged.type !== "text-page") return
              expect(paged.content).toBe("第二行")
              expect(paged.next).toBe(3)
              const whole = yield* ReadToolFileSystem.read(environment.files, absolute, "utf16le.txt")
              expect(whole.type).toBe("text-page")
              if (whole.type !== "text-page") return
              expect(whole.content).toContain("第一行")
              expect(whole.content).toContain("第三行")
            }),
          ),
        ),
      )
    }),
  )

  it.live("reads files whose encoding cannot be identified lossily as UTF-8", () =>
    withTempDir((tmp) => {
      const target = path.join(tmp.path, "junk.txt")
      return Effect.promise(() => fs.writeFile(target, Uint8Array.from({ length: 64 }, (_, index) => (index % 2 === 0 ? 0x81 : 0xff)))).pipe(
        Effect.andThen(
          withTools(tmp.path, () =>
            Effect.gen(function* () {
              const environment = yield* Environment.Service
              const absolute = AbsolutePath.make(yield* Effect.promise(() => fs.realpath(target)))
              const result = yield* Effect.result(
                ReadToolFileSystem.read(environment.files, absolute, "junk.txt"),
              )
              expect(Result.isSuccess(result)).toBe(true)
            }),
          ),
        ),
      )
    }),
  )
})
