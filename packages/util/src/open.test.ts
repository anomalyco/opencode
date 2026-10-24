import { describe, expect, test } from "bun:test"
import { chmodSync, existsSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { browserCommands, openUrl } from "./open.js"

describe("openUrl", () => {
  test("rejects values that are not URLs", async () => {
    await expect(openUrl("not a url")).rejects.toThrow("Only http and https links")
    await expect(openUrl("")).rejects.toThrow("Only http and https links")
  })

  test("rejects non-http schemes", async () => {
    await expect(openUrl("file:///etc/hosts")).rejects.toThrow("Only http and https links")
    await expect(openUrl("javascript:alert(1)")).rejects.toThrow("Only http and https links")
    await expect(openUrl("ms-msdt:/id PCWDiagnostic")).rejects.toThrow("Only http and https links")
    await expect(openUrl("\\\\server\\share\\file.html")).rejects.toThrow("Only http and https links")
  })
})

describe("browserCommands", () => {
  test("is ignored on Windows", () => {
    expect(browserCommands("https://example.com", { BROWSER: "/usr/bin/firefox" }, "win32")).toEqual([])
  })

  test("returns the command and appends the URL", () => {
    expect(browserCommands("https://example.com", { BROWSER: "/usr/bin/firefox" }, "linux")).toEqual([
      { command: "/usr/bin/firefox", args: ["https://example.com"] },
    ])
  })

  test("keeps arguments and expands %s exactly once", () => {
    expect(browserCommands("https://example.com", { BROWSER: "firefox --new-tab %s" }, "linux")).toEqual([
      { command: "firefox", args: ["--new-tab", "https://example.com"] },
    ])
  })

  test("expands %c and %% like webbrowser does", () => {
    expect(browserCommands("https://example.com", { BROWSER: "browser a%cb %%" }, "linux")).toEqual([
      { command: "browser", args: ["a:b", "%", "https://example.com"] },
    ])
  })

  test("does not interpret $ replacement patterns in the URL", () => {
    expect(browserCommands("https://example.com/$&", { BROWSER: "browser %s" }, "linux")).toEqual([
      { command: "browser", args: ["https://example.com/$&"] },
    ])
  })

  test("keeps colon-separated candidates in order", () => {
    expect(browserCommands("https://example.com", { BROWSER: "first:second --tab" }, "linux")).toEqual([
      { command: "first", args: ["https://example.com"] },
      { command: "second", args: ["--tab", "https://example.com"] },
    ])
  })

  test("returns an empty list for an empty BROWSER", () => {
    expect(browserCommands("https://example.com", { BROWSER: "  " }, "linux")).toEqual([])
  })
})

if (process.platform !== "win32") {
  test("openUrl spawns BROWSER", async () => {
    const dir = mkdtempSync(join(tmpdir(), "opencode-browser-"))
    const out = join(dir, "url")
    const script = join(dir, "browser.sh")
    writeFileSync(script, `#!/bin/sh\nprintf %s "$1" > '${out}'\n`)
    chmodSync(script, 0o755)
    const previous = process.env.BROWSER
    process.env.BROWSER = script
    try {
      await openUrl("https://example.com/path")
      for (let i = 0; i < 50 && !existsSync(out); i++) await Bun.sleep(20)
      expect(await Bun.file(out).text()).toBe("https://example.com/path")
    } finally {
      if (previous === undefined) delete process.env.BROWSER
      else process.env.BROWSER = previous
    }
  })

  test("openUrl falls through to the next candidate", async () => {
    const dir = mkdtempSync(join(tmpdir(), "opencode-browser-"))
    const out = join(dir, "url")
    const script = join(dir, "browser.sh")
    writeFileSync(script, `#!/bin/sh\nprintf %s "$1" > '${out}'\n`)
    chmodSync(script, 0o755)
    const previous = process.env.BROWSER
    process.env.BROWSER = `/nonexistent-browser:${script}`
    try {
      await openUrl("https://example.com/later")
      for (let i = 0; i < 50 && !existsSync(out); i++) await Bun.sleep(20)
      expect(await Bun.file(out).text()).toBe("https://example.com/later")
    } finally {
      if (previous === undefined) delete process.env.BROWSER
      else process.env.BROWSER = previous
    }
  })
}
