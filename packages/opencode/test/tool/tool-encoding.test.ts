// Integration tests verifying that the agent file tools (read, write, edit,
// apply_patch) detect and preserve the original encoding of files on disk.
// Tests exercise the real tool pipeline rather than the Encoding helper
// directly so we validate end-to-end behaviour.

import { afterEach, describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import path from "path"
import fs from "fs/promises"
import iconv from "iconv-lite"
import { Agent } from "@/agent/agent"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import { ApplyPatchTool } from "@/tool/apply_patch"
import { Bus } from "@/bus"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { EditTool } from "@/tool/edit"
import { Format } from "@/format"
import { Instruction } from "@/session/instruction"
import { LSP } from "@/lsp/lsp"
import { MessageID, SessionID } from "@/session/schema"
import { ReadTool } from "@/tool/read"
import * as Tool from "@/tool/tool"
import { Truncate } from "@/tool/truncate"
import { WriteTool } from "@/tool/write"
import { disposeAllInstances, provideTmpdirInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

const ctx = {
  sessionID: SessionID.make("ses_test-encoding"),
  messageID: MessageID.make(""),
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

const it = testEffect(
  Layer.mergeAll(
    Agent.defaultLayer,
    AppFileSystem.defaultLayer,
    CrossSpawnSpawner.defaultLayer,
    Instruction.defaultLayer,
    LSP.defaultLayer,
    Bus.layer,
    Format.defaultLayer,
    Truncate.defaultLayer,
  ),
)

const runRead = (args: Tool.InferParameters<typeof ReadTool>) =>
  Effect.gen(function* () {
    const info = yield* ReadTool
    const tool = yield* info.init()
    return yield* tool.execute(args, ctx)
  })

const runWrite = (args: Tool.InferParameters<typeof WriteTool>) =>
  Effect.gen(function* () {
    const info = yield* WriteTool
    const tool = yield* info.init()
    return yield* tool.execute(args, ctx)
  })

const runEdit = (args: Tool.InferParameters<typeof EditTool>) =>
  Effect.gen(function* () {
    const info = yield* EditTool
    const tool = yield* info.init()
    return yield* tool.execute(args, ctx)
  })

const runPatch = (args: Tool.InferParameters<typeof ApplyPatchTool>) =>
  Effect.gen(function* () {
    const info = yield* ApplyPatchTool
    const tool = yield* info.init()
    return yield* tool.execute(args, ctx)
  })

// iconv-lite's UTF codecs don't emit BOMs, but this codebase supports
// "UTF-X with BOM" as a distinct variant. Prepend one here for fixture files
// that are meant to have one.
const UTF8_BOM = "utf-8-bom"
const encodeBytes = (text: string, encoding: string): Buffer => {
  if (encoding === UTF8_BOM) return Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), iconv.encode(text, "utf-8")])
  const lower = encoding.toLowerCase()
  if (lower === "utf-16le") return Buffer.concat([Buffer.from([0xff, 0xfe]), iconv.encode(text, encoding)])
  if (lower === "utf-16be") return Buffer.concat([Buffer.from([0xfe, 0xff]), iconv.encode(text, encoding)])
  if (lower === "utf-32le") return Buffer.concat([Buffer.from([0xff, 0xfe, 0x00, 0x00]), iconv.encode(text, encoding)])
  if (lower === "utf-32be") return Buffer.concat([Buffer.from([0x00, 0x00, 0xfe, 0xff]), iconv.encode(text, encoding)])
  return iconv.encode(text, encoding)
}

// Create a file with the given encoding by writing raw bytes.
const putEncoded = (filepath: string, text: string, encoding: string) =>
  Effect.promise(async () => {
    await fs.mkdir(path.dirname(filepath), { recursive: true })
    await fs.writeFile(filepath, encodeBytes(text, encoding))
  })

const loadDecoded = (filepath: string, encoding: string) =>
  Effect.promise(async () => {
    const bytes = await fs.readFile(filepath)
    if (encoding === UTF8_BOM) {
      const stripped = bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf
      return iconv.decode(stripped ? bytes.subarray(3) : bytes, "utf-8")
    }
    return iconv.decode(bytes, encoding)
  })

const loadBytes = (filepath: string) => Effect.promise(() => fs.readFile(filepath))

// Sample phrases chosen to exercise each encoding's characteristic byte patterns.
const samples = {
  utf8: "Hello, world! — £100",
  shiftJis: "こんにちは、世界！日本語のテストです。",
  eucJp: "日本語のEUC-JPテスト文字列です。",
  gb2312: "你好，世界！这是简体中文测试。",
  big5: "你好，世界！這是繁體中文測試。",
  eucKr: "안녕하세요, 세계! 한국어 테스트입니다.",
  windows1251: "Привет, мир! Это тест кириллицы.",
  koi8r: "Привет, мир! КОИ-8 Р тест.",
}

describe("tool encoding preservation", () => {
  describe("ReadTool decodes files with non-UTF-8 encodings", () => {
    const cases: Array<[string, string, string]> = [
      ["UTF-8", "utf-8", samples.utf8],
      ["UTF-8 with BOM", UTF8_BOM, samples.utf8],
      ["UTF-16 LE with BOM", "utf-16le", samples.utf8],
      ["UTF-16 BE with BOM", "utf-16be", samples.utf8],
      ["UTF-32 LE with BOM", "utf-32le", samples.utf8],
      ["UTF-32 BE with BOM", "utf-32be", samples.utf8],
      ["Shift_JIS", "Shift_JIS", samples.shiftJis],
      ["EUC-JP", "euc-jp", samples.eucJp],
      ["GB2312", "gb2312", samples.gb2312],
      ["Big5", "big5", samples.big5],
      ["EUC-KR", "euc-kr", samples.eucKr],
      ["Windows-1251", "windows-1251", samples.windows1251],
      ["KOI8-R", "koi8-r", samples.koi8r],
    ]

    for (const [label, encoding, text] of cases) {
      it.live(`decodes ${label} content for the model`, () =>
        provideEncoded(encoding, text, (filepath) =>
          Effect.gen(function* () {
            const result = yield* runRead({ filePath: filepath })
            expect(result.output).toContain(text)
          }),
        ),
      )
    }
  })

  describe("ReadTool does not flag non-Latin text files as binary", () => {
    it.live("accepts Shift_JIS", () =>
      provideEncoded("Shift_JIS", samples.shiftJis, (filepath) =>
        Effect.gen(function* () {
          const result = yield* runRead({ filePath: filepath })
          expect(result.output).toContain(samples.shiftJis)
        }),
      ),
    )

    it.live("accepts UTF-16 LE with BOM (contains NUL bytes)", () =>
      provideEncoded("utf-16le", samples.utf8, (filepath) =>
        Effect.gen(function* () {
          const result = yield* runRead({ filePath: filepath })
          expect(result.output).toContain(samples.utf8)
        }),
      ),
    )

    it.live("accepts UTF-32 LE with BOM (3 of every 4 bytes are NUL)", () =>
      provideEncoded("utf-32le", samples.utf8, (filepath) =>
        Effect.gen(function* () {
          const result = yield* runRead({ filePath: filepath })
          expect(result.output).toContain(samples.utf8)
        }),
      ),
    )
  })

  describe("WriteTool preserves existing file encoding when overwriting", () => {
    const cases: Array<[string, string, string]> = [
      ["UTF-8 with BOM", UTF8_BOM, samples.utf8],
      ["Shift_JIS", "Shift_JIS", samples.shiftJis],
      ["GB2312", "gb2312", samples.gb2312],
      ["Windows-1251", "windows-1251", samples.windows1251],
      ["UTF-16 LE", "utf-16le", samples.utf8],
      ["UTF-32 LE", "utf-32le", samples.utf8],
      ["UTF-32 BE", "utf-32be", samples.utf8],
    ]

    for (const [label, encoding, original] of cases) {
      it.live(`preserves ${label} encoding on overwrite`, () =>
        provideTmpdirInstance((dir) =>
          Effect.gen(function* () {
            const filepath = path.join(dir, "file.txt")
            yield* putEncoded(filepath, original, encoding)

            const replacement = original + " updated"
            yield* runWrite({ filePath: filepath, content: replacement })

            const decoded = yield* loadDecoded(filepath, encoding)
            expect(decoded).toBe(replacement)

            // Bytes should still match the original encoding (and differ from UTF-8).
            const bytes = yield* loadBytes(filepath)
            expect(bytes.equals(encodeBytes(replacement, encoding))).toBe(true)
          }),
        ),
      )
    }

    it.live("defaults new files to UTF-8", () =>
      provideTmpdirInstance((dir) =>
        Effect.gen(function* () {
          const filepath = path.join(dir, "new.txt")
          yield* runWrite({ filePath: filepath, content: samples.utf8 })

          const bytes = yield* loadBytes(filepath)
          expect(bytes.equals(Buffer.from(samples.utf8, "utf-8"))).toBe(true)
        }),
      ),
    )

    // Guard against double-BOM regressions: if the model ever hands back content
    // that already starts with U+FEFF (e.g. by round-tripping literal bytes),
    // writing it to a BOM-encoded file must still produce exactly one BOM.
    const bomCases: Array<[string, string, Buffer]> = [
      ["UTF-8 with BOM", UTF8_BOM, Buffer.from([0xef, 0xbb, 0xbf])],
      ["UTF-16 LE", "utf-16le", Buffer.from([0xff, 0xfe])],
      ["UTF-16 BE", "utf-16be", Buffer.from([0xfe, 0xff])],
      ["UTF-32 LE", "utf-32le", Buffer.from([0xff, 0xfe, 0x00, 0x00])],
      ["UTF-32 BE", "utf-32be", Buffer.from([0x00, 0x00, 0xfe, 0xff])],
    ]
    for (const [label, encoding, bom] of bomCases) {
      it.live(`does not emit a double BOM for ${label} when content starts with U+FEFF`, () =>
        provideTmpdirInstance((dir) =>
          Effect.gen(function* () {
            const filepath = path.join(dir, "file.txt")
            yield* putEncoded(filepath, "hello", encoding)

            yield* runWrite({ filePath: filepath, content: "\uFEFFgoodbye" })

            const bytes = yield* loadBytes(filepath)
            // Exactly one BOM prefix, immediately followed by encoded payload.
            expect(bytes.subarray(0, bom.length).equals(bom)).toBe(true)
            expect(bytes.subarray(bom.length, bom.length * 2).equals(bom)).toBe(false)
            const decoded = yield* loadDecoded(filepath, encoding)
            expect(decoded).toBe("goodbye")
          }),
        ),
      )
    }
  })

  describe("EditTool preserves existing file encoding across edits", () => {
    const cases: Array<[string, string, string, string, string]> = [
      ["UTF-8 with BOM", UTF8_BOM, samples.utf8 + "\n second line", "world", "earth"],
      ["Shift_JIS", "Shift_JIS", samples.shiftJis, "日本語", "ニホンゴ"],
      ["GB2312", "gb2312", samples.gb2312, "简体中文", "中文简体"],
      ["Windows-1251", "windows-1251", samples.windows1251, "мир", "планета"],
      ["UTF-16 LE", "utf-16le", samples.utf8 + "\n second line", "world", "earth"],
      ["UTF-32 LE", "utf-32le", samples.utf8 + "\n second line", "world", "earth"],
    ]

    for (const [label, encoding, original, oldString, newString] of cases) {
      it.live(`preserves ${label} through edit`, () =>
        provideTmpdirInstance((dir) =>
          Effect.gen(function* () {
            const filepath = path.join(dir, "doc.txt")
            yield* putEncoded(filepath, original, encoding)

            yield* runEdit({ filePath: filepath, oldString, newString })

            const decoded = yield* loadDecoded(filepath, encoding)
            const expected = original.replace(oldString, newString)
            expect(decoded).toBe(expected)

            const bytes = yield* loadBytes(filepath)
            expect(bytes.equals(encodeBytes(expected, encoding))).toBe(true)
          }),
        ),
      )
    }
  })

  describe("ApplyPatchTool preserves encoding", () => {
    it.live("preserves Shift_JIS through an update hunk", () =>
      provideTmpdirInstance((dir) =>
        Effect.gen(function* () {
          const filepath = path.join(dir, "doc.txt")
          const replacement = "日本語"
          const original = "line1\n" + samples.shiftJis + "\nline3\n"
          const expected = original.replace(samples.shiftJis, replacement)
          yield* putEncoded(filepath, original, "Shift_JIS")

          const patch = [
            "*** Begin Patch",
            "*** Update File: doc.txt",
            "@@",
            " line1",
            "-" + samples.shiftJis,
            "+" + replacement,
            " line3",
            "*** End Patch",
          ].join("\n")

          yield* runPatch({ patchText: patch })

          const decoded = yield* loadDecoded(filepath, "Shift_JIS")
          expect(decoded).toBe(expected)

          // Bytes must still be Shift_JIS, not silently promoted to UTF-8.
          const bytes = yield* loadBytes(filepath)
          expect(bytes.equals(encodeBytes(expected, "Shift_JIS"))).toBe(true)
        }),
      ),
    )

    // Regression guard: the diff and additions/deletions counts surfaced to the
    // user (and to the permission prompt) are derived from the pre-patch read
    // of the file. A previous version reused a hard-coded UTF-8 decoder for
    // that read, producing mojibake for any non-UTF-8 file. The bytes ended up
    // correct because the patch helper does its own encoding-aware read, so
    // tests that only checked final file bytes (above) missed the bug.
    it.live("returns a non-mojibake diff for a Shift_JIS update", () =>
      provideTmpdirInstance((dir) =>
        Effect.gen(function* () {
          const filepath = path.join(dir, "doc.txt")
          const replacement = "日本語"
          const original = "line1\n" + samples.shiftJis + "\nline3\n"
          yield* putEncoded(filepath, original, "Shift_JIS")

          const patch = [
            "*** Begin Patch",
            "*** Update File: doc.txt",
            "@@",
            " line1",
            "-" + samples.shiftJis,
            "+" + replacement,
            " line3",
            "*** End Patch",
          ].join("\n")

          const result = (yield* runPatch({ patchText: patch })) as {
            metadata: {
              diff: string
              files: Array<{ additions: number; deletions: number }>
            }
          }

          // The diff must contain the real decoded old/new lines, not a UTF-8
          // misread of the Shift_JIS bytes (which would surface as U+FFFD).
          expect(result.metadata.diff).toContain(samples.shiftJis)
          expect(result.metadata.diff).toContain(replacement)
          expect(result.metadata.diff).not.toContain("\uFFFD")

          // Per-file stats are derived from the same diff, so a mojibake read
          // would inflate both additions and deletions.
          expect(result.metadata.files).toHaveLength(1)
          expect(result.metadata.files[0].additions).toBe(1)
          expect(result.metadata.files[0].deletions).toBe(1)
        }),
      ),
    )

    it.live("new files added via apply_patch are UTF-8", () =>
      provideTmpdirInstance((dir) =>
        Effect.gen(function* () {
          const patch = ["*** Begin Patch", "*** Add File: new.txt", "+hello world", "*** End Patch"].join("\n")
          yield* runPatch({ patchText: patch })
          const bytes = yield* loadBytes(path.join(dir, "new.txt"))
          expect(bytes.equals(Buffer.from("hello world\n", "utf-8"))).toBe(true)
        }),
      ),
    )

    // Deletes exercise a code path in patch/index.ts that doesn't write bytes
    // back — verify it still works when the target file is non-UTF-8, because
    // the deletion code has to decode the old contents to confirm match.
    it.live("deletes a Windows-1251 file without UTF-8 corruption errors", () =>
      provideTmpdirInstance((dir) =>
        Effect.gen(function* () {
          const filepath = path.join(dir, "legacy.txt")
          yield* putEncoded(filepath, samples.windows1251, "windows-1251")
          const patch = ["*** Begin Patch", "*** Delete File: legacy.txt", "*** End Patch"].join("\n")
          yield* runPatch({ patchText: patch })
          const exists = yield* Effect.promise(() =>
            fs
              .access(filepath)
              .then(() => true)
              .catch(() => false),
          )
          expect(exists).toBe(false)
        }),
      ),
    )
  })

  // EditTool's replaceAll path rewrites the entire buffer and re-encodes it
  // in one shot — regression guard that re-encoding a multi-occurrence edit in
  // a legacy encoding yields byte-exact output.
  describe("EditTool replaceAll preserves non-UTF-8 encoding", () => {
    it.live("replaces every occurrence in Shift_JIS", () =>
      provideTmpdirInstance((dir) =>
        Effect.gen(function* () {
          const filepath = path.join(dir, "doc.txt")
          // Pad with additional Shift_JIS text so chardet has enough bytes
          // to confidently identify the encoding.
          const pad = samples.shiftJis + "\n"
          const original = pad + "日本語\n日本語\n日本語\n" + pad
          yield* putEncoded(filepath, original, "Shift_JIS")

          yield* runEdit({ filePath: filepath, oldString: "日本語", newString: "ニホンゴ", replaceAll: true })

          const expected =
            pad.replaceAll("日本語", "ニホンゴ") +
            "ニホンゴ\nニホンゴ\nニホンゴ\n" +
            pad.replaceAll("日本語", "ニホンゴ")
          const decoded = yield* loadDecoded(filepath, "Shift_JIS")
          expect(decoded).toBe(expected)
          const bytes = yield* loadBytes(filepath)
          expect(bytes.equals(encodeBytes(expected, "Shift_JIS"))).toBe(true)
        }),
      ),
    )
  })
})

// Shared helper to set up a temp instance with an encoded file at `file.txt`.
function provideEncoded<A, E, R>(encoding: string, text: string, body: (filepath: string) => Effect.Effect<A, E, R>) {
  return provideTmpdirInstance((dir) =>
    Effect.gen(function* () {
      const filepath = path.join(dir, "file.txt")
      yield* putEncoded(filepath, text, encoding)
      return yield* body(filepath)
    }),
  )
}
