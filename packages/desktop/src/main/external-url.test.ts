import { describe, expect, test } from "bun:test"
import { resolve } from "node:path"
import { pathToFileURL } from "node:url"
import { resolveExternalURL, resolveLocalFilePath } from "./external-url"

describe("external URLs", () => {
  test("opens web URLs externally", () => {
    expect(resolveExternalURL("https://example.com/a?b=c")).toBe("https://example.com/a?b=c")
    expect(resolveExternalURL("http://example.com")).toBe("http://example.com/")
  })

  test("opens mail links externally", () => {
    expect(resolveExternalURL("mailto:hello@opencode.ai")).toBe("mailto:hello@opencode.ai")
  })

  test("rejects file URLs and unsupported protocols", () => {
    expect(resolveExternalURL("file:///tmp/index.html")).toBeUndefined()
    expect(resolveExternalURL("javascript:alert(1)")).toBeUndefined()
    expect(resolveExternalURL("data:text/html,hello")).toBeUndefined()
    expect(resolveExternalURL("not a url")).toBeUndefined()
  })

  test("resolves only local file URLs", () => {
    const path = resolve("example.html")
    expect(resolveLocalFilePath(pathToFileURL(path).href)).toBe(path)
    expect(resolveLocalFilePath("file://example.com/share/index.html")).toBeUndefined()
    expect(resolveLocalFilePath("https://example.com/index.html")).toBeUndefined()
  })

  test("refuses local paths the OS would execute instead of open", () => {
    const executable = ["payload.exe", "payload.bat", "payload.cmd", "payload.hta", "payload.lnk", "payload.jar", "Payload.EXE", "payload.exe ", "payload.exe..."]
    for (const name of executable) {
      expect(resolveLocalFilePath(pathToFileURL(resolve(name)).href), name).toBeUndefined()
    }
    const bundle = resolve("My.app")
    expect(resolveLocalFilePath(pathToFileURL(bundle + "/Contents/MacOS/My").href)).toBeUndefined()
    expect(resolveLocalFilePath(pathToFileURL(resolve("runme.command")).href)).toBeUndefined()
    expect(resolveLocalFilePath(pathToFileURL(resolve("install.pkg")).href)).toBeUndefined()
    // Documents still open normally.
    expect(resolveLocalFilePath(pathToFileURL(resolve("readme.md")).href)).toBe(resolve("readme.md"))
    expect(resolveLocalFilePath(pathToFileURL(resolve("payload.exe.txt")).href)).toBe(resolve("payload.exe.txt"))
  })
})
