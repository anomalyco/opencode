import { afterEach, describe, expect, test } from "bun:test"
import { mkdtempSync, readFileSync, rmSync, statSync } from "fs"
import os from "os"
import path from "path"
import { installStdioFileGuard, installStdioGuard } from "../../src/util/stdio-guard"

// Each test swaps in its own sentinel `write` so the real terminal is never touched and
// so "did the underlying stream get written to?" is directly observable.
function sentinel(stream: NodeJS.WriteStream) {
  const received: string[] = []
  const original = stream.write
  stream.write = ((chunk: unknown) => {
    received.push(typeof chunk === "string" ? chunk : String(chunk))
    return true
  }) as typeof stream.write
  return { received, installed: stream.write, restore: () => (stream.write = original) }
}

let cleanup: Array<() => void> = []

afterEach(() => {
  cleanup.forEach((fn) => fn())
  cleanup = []
})

describe("util.stdio-guard", () => {
  test("routes stderr writes to the sink instead of the stream", () => {
    const stderr = sentinel(process.stderr)
    cleanup.push(stderr.restore)
    const captured: string[] = []

    const restore = installStdioGuard((text) => captured.push(text))
    process.stderr.write("stray plugin log\n")
    restore()

    expect(captured).toEqual(["stray plugin log\n"])
    expect(stderr.received).toEqual([])
  })

  test("routes stdout writes to the sink instead of the stream", () => {
    const stdout = sentinel(process.stdout)
    cleanup.push(stdout.restore)
    const captured: string[] = []

    const restore = installStdioGuard((text) => captured.push(text))
    process.stdout.write("stray stdout\n")
    restore()

    expect(captured).toEqual(["stray stdout\n"])
    expect(stdout.received).toEqual([])
  })

  test("decodes Buffer chunks", () => {
    const stderr = sentinel(process.stderr)
    cleanup.push(stderr.restore)
    const captured: string[] = []

    const restore = installStdioGuard((text) => captured.push(text))
    process.stderr.write(Buffer.from("buffered ✓", "utf8"))
    restore()

    expect(captured).toEqual(["buffered ✓"])
  })

  test("restores the exact original write functions", () => {
    const stderr = sentinel(process.stderr)
    const stdout = sentinel(process.stdout)
    cleanup.push(stderr.restore, stdout.restore)

    const restore = installStdioGuard(() => {})
    expect(process.stderr.write).not.toBe(stderr.installed)
    expect(process.stdout.write).not.toBe(stdout.installed)

    restore()
    expect(process.stderr.write).toBe(stderr.installed)
    expect(process.stdout.write).toBe(stdout.installed)
  })

  test("writes reach the stream again after restore", () => {
    const stderr = sentinel(process.stderr)
    cleanup.push(stderr.restore)
    const captured: string[] = []

    const restore = installStdioGuard((text) => captured.push(text))
    restore()
    process.stderr.write("fatal error must stay visible\n")

    expect(captured).toEqual([])
    expect(stderr.received).toEqual(["fatal error must stay visible\n"])
  })

  test("honors the write callback in both argument positions", async () => {
    const stderr = sentinel(process.stderr)
    cleanup.push(stderr.restore)

    const restore = installStdioGuard(() => {})
    const calls = await new Promise<string[]>((resolve) => {
      const seen: string[] = []
      process.stderr.write("a", () => {
        seen.push("callback-second-arg")
        process.stderr.write("b", "utf8", () => {
          seen.push("callback-third-arg")
          resolve(seen)
        })
      })
    })
    restore()

    expect(calls).toEqual(["callback-second-arg", "callback-third-arg"])
  })

  test("a throwing sink never propagates into the caller", () => {
    const stderr = sentinel(process.stderr)
    cleanup.push(stderr.restore)

    const restore = installStdioGuard(() => {
      throw new Error("sink is broken")
    })
    expect(() => process.stderr.write("still fine\n")).not.toThrow()
    expect(process.stderr.write("still fine\n")).toBe(true)
    restore()
  })

  test("file guard appends privately and closes on restore", () => {
    const directory = mkdtempSync(path.join(os.tmpdir(), "opencode-stdio-"))
    const file = path.join(directory, "stdio.log")
    cleanup.push(() => rmSync(directory, { recursive: true, force: true }))

    const restore = installStdioFileGuard(file)
    process.stderr.write("captured\n")
    restore()

    expect(readFileSync(file, "utf8")).toBe("captured\n")
    expect(statSync(file).mode & 0o777).toBe(0o600)
  })

  test("file guard truncates and bounds captured output", () => {
    const directory = mkdtempSync(path.join(os.tmpdir(), "opencode-stdio-"))
    const file = path.join(directory, "stdio.log")
    cleanup.push(() => rmSync(directory, { recursive: true, force: true }))

    const first = installStdioFileGuard(file)
    process.stderr.write("old content")
    first()

    const restore = installStdioFileGuard(file, { maxBytes: 5, truncate: true })
    process.stderr.write("123456789")
    restore()

    expect(readFileSync(file, "utf8")).toBe("12345")
  })

  test("file guard counts existing content toward the limit", () => {
    const directory = mkdtempSync(path.join(os.tmpdir(), "opencode-stdio-"))
    const file = path.join(directory, "stdio.log")
    cleanup.push(() => rmSync(directory, { recursive: true, force: true }))

    const first = installStdioFileGuard(file)
    process.stderr.write("1234")
    first()

    const restore = installStdioFileGuard(file, { maxBytes: 5 })
    process.stderr.write("678")
    restore()

    expect(readFileSync(file, "utf8")).toBe("12346")
  })

  test("file guard still contains writes when the file cannot be opened", () => {
    const stderr = sentinel(process.stderr)
    cleanup.push(stderr.restore)

    const restore = installStdioFileGuard(path.join(os.tmpdir(), crypto.randomUUID(), "stdio.log"))
    process.stderr.write("do not paint the terminal")
    restore()

    expect(stderr.received).toEqual([])
  })
})
