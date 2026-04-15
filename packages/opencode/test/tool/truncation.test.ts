import { describe, test, expect } from "bun:test"
import { NodeFileSystem } from "@effect/platform-node"
import { Effect, FileSystem, Layer } from "effect"
import { Truncate } from "../../src/tool/truncate"
import { Identifier } from "../../src/id/id"
import { Process } from "../../src/util/process"
import { Filesystem } from "../../src/util/filesystem"
import path from "path"
import { testEffect } from "../lib/effect"
import { writeFileStringScoped } from "../lib/filesystem"

const FIXTURES_DIR = path.join(import.meta.dir, "fixtures")
const ROOT = path.resolve(import.meta.dir, "..", "..")

const it = testEffect(Layer.mergeAll(Truncate.defaultLayer, NodeFileSystem.layer))

describe("Truncate", () => {
  describe("output", () => {
    it.live("truncates large json file by bytes", () =>
      Effect.gen(function* () {
        const svc = yield* Truncate.Service
        const content = yield* Effect.promise(() => Filesystem.readText(path.join(FIXTURES_DIR, "models-api.json")))
        const result = yield* svc.output(content)

        expect(result.truncated).toBe(true)
        expect(result.content).toContain("truncated...")
        if (result.truncated) expect(result.outputPath).toBeDefined()
      }),
    )

    it.live("returns content unchanged when under limits", () =>
      Effect.gen(function* () {
        const svc = yield* Truncate.Service
        const content = "line1\nline2\nline3"
        const result = yield* svc.output(content)

        expect(result.truncated).toBe(false)
        expect(result.content).toBe(content)
      }),
    )

    it.live("truncates by line count", () =>
      Effect.gen(function* () {
        const svc = yield* Truncate.Service
        const lines = Array.from({ length: 100 }, (_, i) => `line${i}`).join("\n")
        const result = yield* svc.output(lines, { maxLines: 10 })

        expect(result.truncated).toBe(true)
        expect(result.content).toContain("...90 lines truncated...")
      }),
    )

    it.live("truncates by byte count", () =>
      Effect.gen(function* () {
        const svc = yield* Truncate.Service
        const content = "a".repeat(1000)
        const result = yield* svc.output(content, { maxBytes: 100 })

        expect(result.truncated).toBe(true)
        expect(result.content).toContain("truncated...")
      }),
    )

    it.live("truncates from head by default", () =>
      Effect.gen(function* () {
        const svc = yield* Truncate.Service
        const lines = Array.from({ length: 10 }, (_, i) => `line${i}`).join("\n")
        const result = yield* svc.output(lines, { maxLines: 3 })

        expect(result.truncated).toBe(true)
        expect(result.content).toContain("line0")
        expect(result.content).toContain("line1")
        expect(result.content).toContain("line2")
        expect(result.content).not.toContain("line9")
      }),
    )

    it.live("truncates from tail when direction is tail", () =>
      Effect.gen(function* () {
        const svc = yield* Truncate.Service
        const lines = Array.from({ length: 10 }, (_, i) => `line${i}`).join("\n")
        const result = yield* svc.output(lines, { maxLines: 3, direction: "tail" })

        expect(result.truncated).toBe(true)
        expect(result.content).toContain("line7")
        expect(result.content).toContain("line8")
        expect(result.content).toContain("line9")
        expect(result.content).not.toContain("line0")
      }),
    )

    test("uses default MAX_LINES and MAX_BYTES", () => {
      expect(Truncate.MAX_LINES).toBe(2000)
      expect(Truncate.MAX_BYTES).toBe(50 * 1024)
    })

    it.live("large single-line file truncates with byte message", () =>
      Effect.gen(function* () {
        const svc = yield* Truncate.Service
        const content = yield* Effect.promise(() => Filesystem.readText(path.join(FIXTURES_DIR, "models-api.json")))
        const result = yield* svc.output(content)

        expect(result.truncated).toBe(true)
        expect(result.content).toContain("bytes truncated...")
        expect(Buffer.byteLength(content, "utf-8")).toBeGreaterThan(Truncate.MAX_BYTES)
      }),
    )

    it.live("writes full output to file when truncated", () =>
      Effect.gen(function* () {
        const svc = yield* Truncate.Service
        const lines = Array.from({ length: 100 }, (_, i) => `line${i}`).join("\n")
        const result = yield* svc.output(lines, { maxLines: 10 })

        expect(result.truncated).toBe(true)
        expect(result.content).toContain("The tool call succeeded but the output was truncated")
        expect(result.content).toContain("Grep")
        if (!result.truncated) throw new Error("expected truncated")
        expect(result.outputPath).toBeDefined()
        expect(result.outputPath).toContain("tool_")

        const written = yield* Effect.promise(() => Filesystem.readText(result.outputPath!))
        expect(written).toBe(lines)
      }),
    )

    it.live("suggests Task tool when agent has task permission", () =>
      Effect.gen(function* () {
        const svc = yield* Truncate.Service
        const lines = Array.from({ length: 100 }, (_, i) => `line${i}`).join("\n")
        const agent = { permission: [{ permission: "task", pattern: "*", action: "allow" as const }] }
        const result = yield* svc.output(lines, { maxLines: 10 }, agent as any)

        expect(result.truncated).toBe(true)
        expect(result.content).toContain("Grep")
        expect(result.content).toContain("Task tool")
      }),
    )

    it.live("omits Task tool hint when agent lacks task permission", () =>
      Effect.gen(function* () {
        const svc = yield* Truncate.Service
        const lines = Array.from({ length: 100 }, (_, i) => `line${i}`).join("\n")
        const agent = { permission: [{ permission: "task", pattern: "*", action: "deny" as const }] }
        const result = yield* svc.output(lines, { maxLines: 10 }, agent as any)

        expect(result.truncated).toBe(true)
        expect(result.content).toContain("Grep")
        expect(result.content).not.toContain("Task tool")
      }),
    )

    it.live("does not write file when not truncated", () =>
      Effect.gen(function* () {
        const svc = yield* Truncate.Service
        const content = "short content"
        const result = yield* svc.output(content)

        expect(result.truncated).toBe(false)
        if (result.truncated) throw new Error("expected not truncated")
        expect("outputPath" in result).toBe(false)
      }),
    )

    test("loads truncate effect in a fresh process", async () => {
      const out = await Process.run([process.execPath, "run", path.join(ROOT, "src", "tool", "truncate.ts")], {
        cwd: ROOT,
      })

      expect(out.code).toBe(0)
    }, 20000)
  })

  describe("cleanup", () => {
    const DAY_MS = 24 * 60 * 60 * 1000

    it.live("deletes files older than 7 days and preserves recent files", () =>
      Effect.gen(function* () {
        const svc = yield* Truncate.Service
        const fs = yield* FileSystem.FileSystem

        yield* fs.makeDirectory(Truncate.DIR, { recursive: true })

        const old = path.join(Truncate.DIR, Identifier.create("tool", "ascending", Date.now() - 10 * DAY_MS))
        const recent = path.join(Truncate.DIR, Identifier.create("tool", "ascending", Date.now() - 3 * DAY_MS))

        yield* writeFileStringScoped(old, "old content")
        yield* writeFileStringScoped(recent, "recent content")
        yield* svc.cleanup()

        expect(yield* fs.exists(old)).toBe(false)
        expect(yield* fs.exists(recent)).toBe(true)
      }),
    )
  })
})
