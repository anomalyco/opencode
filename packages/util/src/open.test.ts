import { describe, expect, test } from "bun:test"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { openUrl, resolveOpenTarget } from "./open.js"

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

describe("resolveOpenTarget", () => {
  test("keeps http and https URLs for the browser", () => {
    expect(resolveOpenTarget("https://example.com/docs")).toBe("https://example.com/docs")
    expect(resolveOpenTarget("http://127.0.0.1:4096")).toBe("http://127.0.0.1:4096/")
  })

  test("maps local file URLs and absolute paths to filesystem paths", () => {
    const file = path.join(path.resolve("/tmp"), "example.md")
    expect(resolveOpenTarget(pathToFileURL(file).href)).toBe(file)
    expect(resolveOpenTarget(file)).toBe(file)
  })

  test("keeps Windows drive-qualified paths in either slash style", () => {
    expect(resolveOpenTarget("C:\\Users\\foo\\file.md")).toBe("C:\\Users\\foo\\file.md")
    expect(resolveOpenTarget("C:/Users/foo/file.md")).toBe("C:/Users/foo/file.md")
    expect(resolveOpenTarget("d:\\repo\\plan.md")).toBe("d:\\repo\\plan.md")
  })

  test("resolves relative paths against a session directory base", () => {
    const base = path.resolve("/repo")
    expect(resolveOpenTarget("plan/example.md", base)).toBe(path.join(base, "plan/example.md"))
    expect(resolveOpenTarget("./src/foo.ts", base)).toBe(path.join(base, "src/foo.ts"))
    expect(resolveOpenTarget("../sibling.md", base)).toBe(path.resolve(base, "../sibling.md"))
  })

  test("decodes percent-escaped relative hrefs and drops fragments", () => {
    const base = path.resolve("/repo")
    const notes = path.join(base, "plan notes.md")
    expect(resolveOpenTarget("plan%20notes.md", base)).toBe(notes)
    expect(resolveOpenTarget("./plan%20notes.md", base)).toBe(notes)
    expect(resolveOpenTarget("plan%20notes.md#section", base)).toBe(notes)
    expect(resolveOpenTarget("plan notes.md", base)).toBe(notes)
    // Literal % / # in filenames stay reachable through their encoded forms.
    expect(resolveOpenTarget("foo%2520bar.md", base)).toBe(path.join(base, "foo%20bar.md"))
    expect(resolveOpenTarget("foo%23bar.md", base)).toBe(path.join(base, "foo#bar.md"))
  })

  test("file URLs with fragments resolve to the same path as the bare file URL", () => {
    const file = path.join(path.resolve("/tmp"), "plan notes.md")
    const href = pathToFileURL(file).href
    expect(resolveOpenTarget(`${href}#section`)).toBe(file)
    expect(resolveOpenTarget(href)).toBe(file)
  })

  test("rejects remote file URLs, anchors, and unsafe schemes", () => {
    expect(resolveOpenTarget("file://example.com/share/index.html")).toBeUndefined()
    expect(resolveOpenTarget("javascript:alert(1)")).toBeUndefined()
    expect(resolveOpenTarget("#section", "/repo")).toBeUndefined()
    expect(resolveOpenTarget("packages/tui/src/ui/link.tsx")).toBeUndefined()
    expect(resolveOpenTarget("not a url")).toBeUndefined()
  })
})
