import { describe, expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { registerSecret } from "../../src/util/redact"
import { tmpdir } from "../lib/tmp"
import { config, scriptedAsker, tempDataHome, toolset } from "./harness"
import type { AskRequest } from "../../src/contract"

const data = tempDataHome()

describe("read / write / edit", () => {
  test("write then read shows numbered lines, edit replaces exactly once", async () => {
    await using dir = await tmpdir()
    const tools = await toolset(config(dir.path), { mode: "acceptEdits" })
    expect((await tools.call("write", { filePath: "a.txt", content: "one\ntwo\nthree" })).status).toBe("ok")
    const read = await tools.call("read", { filePath: path.join(dir.path, "a.txt"), offset: 2, limit: 1 })
    expect(read.text).toContain("2: two")
    expect(read.text).not.toContain("1: one")
    expect(read.text).toContain("(Showing lines 2-2 of 3. Use offset=3 to continue.)")

    expect((await tools.call("edit", { filePath: "a.txt", oldString: "two", newString: "TWO" })).status).toBe("ok")
    expect(await dir.read("a.txt")).toBe("one\nTWO\nthree")
  })

  test("edit reports missing and ambiguous matches as errors the model can act on", async () => {
    await using dir = await tmpdir({ files: { "b.txt": "x x" } })
    const tools = await toolset(config(dir.path), { mode: "acceptEdits" })
    const missing = await tools.call("edit", { filePath: "b.txt", oldString: "y", newString: "z" })
    expect(missing.status).toBe("error")
    expect(missing.text).toContain("Could not find oldString")
    const ambiguous = await tools.call("edit", { filePath: "b.txt", oldString: "x", newString: "z" })
    expect(ambiguous.text).toContain("Found multiple matches")
    expect(
      (await tools.call("edit", { filePath: "b.txt", oldString: "x", newString: "z", replaceAll: true })).status,
    ).toBe("ok")
    expect(await dir.read("b.txt")).toBe("z z")
  })

  test("read of a missing file and of a directory", async () => {
    await using dir = await tmpdir({ files: { "sub/c.txt": "c" } })
    const tools = await toolset(config(dir.path))
    expect((await tools.call("read", { filePath: "nope.txt" })).text).toContain("File not found")
    expect((await tools.call("read", { filePath: "." })).text).toContain("sub/")
  })

  test("write is asked in default mode and rejected headless (counted)", async () => {
    await using dir = await tmpdir()
    const tools = await toolset(config(dir.path))
    const result = await tools.call("write", { filePath: "a.txt", content: "x" })
    expect(result.status).toBe("denied")
    expect(result.text).toBe("permission denied: write a.txt")
    expect(await tools.denials()).toBe(1)
    expect(await Bun.file(path.join(dir.path, "a.txt")).exists()).toBe(false)
  })

  test("paths outside cwd go through an external_directory ask", async () => {
    await using dir = await tmpdir()
    await using outside = await tmpdir({ files: { "secret.txt": "s" } })
    const seen: AskRequest[] = []
    const tools = await toolset(config(dir.path), { asker: scriptedAsker(["reject", "once"], seen) })
    const denied = await tools.call("read", { filePath: path.join(outside.path, "secret.txt") })
    expect(denied.status).toBe("denied")
    expect(seen[0].tool).toBe("external_directory")
    expect(seen[0].patterns).toEqual([path.join(outside.path, "*")])
    const allowed = await tools.call("read", { filePath: path.join(outside.path, "secret.txt") })
    expect(allowed.text).toContain("1: s")
  })
})

describe("truncation", () => {
  test("output over 2000 lines is cut, the full text goes to an overflow file named in the hint", async () => {
    await using dir = await tmpdir({
      files: { "big.txt": Array.from({ length: 3000 }, (_, i) => `line ${i}`).join("\n") },
    })
    const tools = await toolset(config(dir.path))
    const result = await tools.call("read", { filePath: "big.txt", limit: 3000 }, "call_big")
    expect(result.overflow_path).toBe(path.join(data, "oclite", "tool-output", "ses_test", "call_big.txt"))
    expect(result.text).toContain(`Full output saved to: ${result.overflow_path}`)
    expect(result.text.split("\n").length).toBeLessThan(2010)
    expect(await Bun.file(result.overflow_path!).text()).toContain("3000: line 2999")
  })

  test("output over 50 KB is cut by bytes", async () => {
    await using dir = await tmpdir({
      files: { "wide.txt": Array.from({ length: 100 }, () => "x".repeat(1000)).join("\n") },
    })
    const tools = await toolset(config(dir.path))
    const result = await tools.call("read", { filePath: "wide.txt" })
    expect(result.text).toContain("bytes truncated")
    expect(result.overflow_path).toBeDefined()
    expect(Buffer.byteLength(result.text)).toBeLessThan(52 * 1024)
  })

  test("a hostile call id can't move the overflow file out of tool-output", async () => {
    await using dir = await tmpdir({ files: { "big.txt": Array.from({ length: 2500 }, (_, i) => `l${i}`).join("\n") } })
    const tools = await toolset(config(dir.path))
    const result = await tools.call("read", { filePath: "big.txt", limit: 3000 }, "../../x")
    expect(result.overflow_path).toBe(path.join(data, "oclite", "tool-output", "ses_test", "______x.txt"))
    expect(await Bun.file(path.join(data, "oclite", "x.txt")).exists()).toBe(false)
  })

  test("reading the overflow file back needs no external_directory ask", async () => {
    await using dir = await tmpdir({ files: { "big.txt": Array.from({ length: 2500 }, (_, i) => `l${i}`).join("\n") } })
    const tools = await toolset(config(dir.path))
    const first = await tools.call("read", { filePath: "big.txt", limit: 3000 })
    const again = await tools.call("read", { filePath: first.overflow_path!, offset: 2400, limit: 5 })
    expect(again.status).toBe("ok")
    expect(again.text).toContain("l2399")
  })
})

describe("symlinks and .env", () => {
  test("a symlink pointing outside cwd can't be written without an external_directory ask", async () => {
    await using dir = await tmpdir()
    await using outside = await tmpdir({ files: { bashrc: "original" } })
    await fs.symlink(path.join(outside.path, "bashrc"), path.join(dir.path, "notes.md"))
    await fs.symlink(path.join(outside.path, "missing.txt"), path.join(dir.path, "dangling.md"))
    const tools = await toolset(config(dir.path), { mode: "acceptEdits" })
    const write = await tools.call("write", { filePath: "notes.md", content: "pwned" })
    expect(write.text).toBe(`permission denied: external_directory ${path.join(outside.path, "*")}`)
    const edit = await tools.call("edit", { filePath: "notes.md", oldString: "original", newString: "pwned" })
    expect(edit.status).toBe("denied")
    expect((await tools.call("write", { filePath: "dangling.md", content: "x" })).status).toBe("denied")
    expect(await outside.read("bashrc")).toBe("original")
    expect(await Bun.file(path.join(outside.path, "missing.txt")).exists()).toBe(false)
  })

  test("read through a symlink to .env hits the .env guard", async () => {
    await using dir = await tmpdir({ files: { ".env": "SECRET=1", ".env.example": "SECRET=" } })
    await fs.symlink(path.join(dir.path, ".env"), path.join(dir.path, "config.txt"))
    const tools = await toolset(config(dir.path))
    expect((await tools.call("read", { filePath: "config.txt" })).status).toBe("denied")
    expect((await tools.call("read", { filePath: ".env" })).status).toBe("denied")
    expect((await tools.call("read", { filePath: ".env.example" })).status).toBe("ok")
  })

  test("bypassPermissions still asks (headless: rejects) for .env via bash, write, edit and grep", async () => {
    await using dir = await tmpdir({ files: { ".env": "SECRET=hunter2", ".env.local": "A=1", "a.txt": "SECRET here" } })
    const tools = await toolset(config(dir.path), { mode: "bypassPermissions" })
    const results = [
      await tools.call("bash", { command: "cat .env" }),
      await tools.call("bash", { command: "cat .env.local" }),
      await tools.call("write", { filePath: ".env", content: "x" }),
      await tools.call("edit", { filePath: ".env.local", oldString: "A", newString: "B" }),
      await tools.call("grep", { pattern: "SECRET", path: ".env" }),
    ]
    expect(results.map((result) => result.status)).toEqual(["denied", "denied", "denied", "denied", "denied"])
    expect((await tools.call("bash", { command: "echo ok > .envrc; cat .envrc" })).text).toBe("ok")
    expect((await tools.call("write", { filePath: ".env.example", content: "A=" })).status).toBe("ok")
    const grep = await tools.call("grep", { pattern: "SECRET" })
    expect(grep.text).toContain("a.txt")
    expect(grep.text).not.toContain("hunter2")
  })
})

describe("overflow files", () => {
  test("are private (0700 dir, 0600 file) and redacted", async () => {
    const secret = `sk-test-${Math.random().toString(36).slice(2)}`
    registerSecret(secret)
    await using dir = await tmpdir({
      files: { "big.txt": [secret, ...Array.from({ length: 2500 }, (_, i) => `l${i}`)].join("\n") },
    })
    const tools = await toolset(config(dir.path))
    const result = await tools.call("read", { filePath: "big.txt", limit: 3000 })
    const file = result.overflow_path!
    expect((await fs.stat(file)).mode & 0o777).toBe(0o600)
    expect((await fs.stat(path.dirname(file))).mode & 0o777).toBe(0o700)
    expect((await fs.stat(path.join(data, "oclite", "tool-output"))).mode & 0o777).toBe(0o700)
    const text = await Bun.file(file).text()
    expect(text).not.toContain(secret)
    expect(text).toContain("***")
  })
})
