import { describe, expect, test } from "bun:test"
import { createPathRewriter } from "@/project/relocation-paths"

const OLD_WIN = "C:\\Users\\skele\\Documents\\auto-resume"
const NEW_WIN = "C:\\Users\\skele\\Documents\\OpenCode plugins"

describe("createPathRewriter", () => {
  test("rewrites plain windows paths", () => {
    const rw = createPathRewriter(OLD_WIN, NEW_WIN)
    const text = `cd ${OLD_WIN} && ls`
    expect(rw.matches(text)).toBe(true)
    expect(rw.rewrite(text)).toBe(`cd ${NEW_WIN} && ls`)
  })

  test("rewrites forward-slashed paths", () => {
    const rw = createPathRewriter(OLD_WIN, NEW_WIN)
    const fwdOld = "C:/Users/skele/Documents/auto-resume"
    const fwdNew = "C:/Users/skele/Documents/OpenCode plugins"
    expect(rw.rewrite(`open "${fwdOld}/tests/x.js"`)).toBe(`open "${fwdNew}/tests/x.js"`)
  })

  test("preserves double-json escape depth (tool payloads)", () => {
    const rw = createPathRewriter(OLD_WIN, NEW_WIN)
    const embedded = '"filePath":"C:\\\\Users\\\\skele\\\\Documents\\\\auto-resume"'
    const expected = '"filePath":"C:\\\\Users\\\\skele\\\\Documents\\\\OpenCode plugins"'
    expect(rw.rewrite(embedded)).toBe(expected)
  })

  test("preserves triple-json escape depth (nested payloads)", () => {
    const rw = createPathRewriter(OLD_WIN, NEW_WIN)
    const embedded = '"blob":"C:\\\\\\\\Users\\\\\\\\skele\\\\\\\\Documents\\\\\\\\auto-resume"'
    expect(rw.rewrite(embedded)).toBe('"blob":"C:\\\\\\\\Users\\\\\\\\skele\\\\\\\\Documents\\\\\\\\OpenCode plugins"')
  })

  test("rewrites drive-less relative form (session.path style)", () => {
    const rw = createPathRewriter("Users/skele/Documents/auto-resume", "Users/skele/Documents/OpenCode plugins")
    expect(rw.rewrite('"title":"Users/skele/Documents/auto-resume/package.json"')).toBe(
      '"title":"Users/skele/Documents/OpenCode plugins/package.json"',
    )
  })

  test("rewrites unix-style leading-separator paths on their own form", () => {
    const rw = createPathRewriter("/Users/alice/Projects/app", "/Users/alice/Projects/app-v2")
    expect(rw.rewrite('cwd: "/Users/alice/Projects/app/src"')).toBe('cwd: "/Users/alice/Projects/app-v2/src"')
  })

  test("handles moves into deeper directories", () => {
    const rw = createPathRewriter(OLD_WIN, "C:\\Users\\skele\\Documents\\work\\OpenCode plugins")
    expect(rw.rewrite(`dir ${OLD_WIN}\\scripts`)).toBe(
      "dir C:\\Users\\skele\\Documents\\work\\OpenCode plugins\\scripts",
    )
  })

  test("handles moves into shallower directories", () => {
    const rw = createPathRewriter("C:\\Users\\skele\\Documents\\work\\app", NEW_WIN)
    expect(rw.rewrite("C:\\Users\\skele\\Documents\\work\\app\\README.md")).toBe(`${NEW_WIN}\\README.md`)
  })

  test("is case-insensitive on the match, canonical on output", () => {
    const rw = createPathRewriter(OLD_WIN, NEW_WIN)
    const out = rw.rewrite("c:/users/SKELE/documents/auto-resume/x")
    expect(out).toBe("C:/Users/skele/Documents/OpenCode plugins/x")
  })

  test("never touches sibling folders", () => {
    const rw = createPathRewriter(OLD_WIN, NEW_WIN)
    for (const sibling of [`${OLD_WIN}-old`, `${OLD_WIN}_v2`, `${OLD_WIN}backup`]) {
      expect(rw.matches(sibling)).toBe(false)
      expect(rw.rewrite(sibling)).toBe(sibling)
    }
  })

  test("never touches other users or unrelated roots", () => {
    const rw = createPathRewriter(OLD_WIN, NEW_WIN)
    for (const foreign of [
      "C:\\Users\\other\\Documents\\auto-resume",
      "/Users/other/Documents/auto-resume",
      "D:\\data\\auto-resume",
    ]) {
      expect(rw.matches(foreign)).toBe(false)
      expect(rw.rewrite(foreign)).toBe(foreign)
    }
  })

  test("never rewrites bare product-name mentions or relative content urls", () => {
    const rw = createPathRewriter(OLD_WIN, NEW_WIN)
    const content = [
      "renamed my auto-resume folder today",
      'new URL("../Documents/auto-resume/auto-resume.js", import.meta.url)',
    ]
    for (const line of content) {
      expect(rw.matches(line)).toBe(false)
      expect(rw.rewrite(line)).toBe(line)
    }
  })

  test("rewrites every occurrence inside large mixed-depth payloads", () => {
    const rw = createPathRewriter(OLD_WIN, NEW_WIN)
    const fwdOld = "C:/Users/skele/Documents/auto-resume"
    const payload = [
      `{"directory":"${fwdOld}"`,
      `"output":"<path>C:\\\\\\\\Users\\\\\\\\skele\\\\\\\\Documents\\\\\\\\auto-resume</path>"`,
      `"title":"Users/skele/Documents/auto-resume/README.md"}`,
    ].join(",")
    const out = rw.rewrite(payload)
    expect(out.toLowerCase()).not.toContain("documents\\auto-resume")
    expect(out.toLowerCase()).not.toContain("documents/auto-resume")
    expect((out.match(/OpenCode plugins/g) ?? []).length).toBe(3)
  })

  test("repeated matches() calls never poison subsequent rewrites (g-flag state)", () => {
    const rw = createPathRewriter(OLD_WIN, NEW_WIN)
    const text = `a ${OLD_WIN} b ${OLD_WIN}/c`
    void rw.matches(text)
    void rw.matches(text)
    const out = rw.rewrite(text)
    expect((out.match(/OpenCode plugins/g) ?? []).length).toBe(2)
  })

  test("throws on component-free paths and identical locations", () => {
    expect(() => createPathRewriter("", NEW_WIN)).toThrow()
    expect(() => createPathRewriter("C:\\", NEW_WIN)).not.toThrow() // drive alone is one comp
    expect(() => createPathRewriter(OLD_WIN, OLD_WIN)).toThrow()
    expect(() => createPathRewriter(OLD_WIN, "c:/USERS/skele/Documents/AUTO-RESUME")).toThrow()
    expect(() => createPathRewriter(`${OLD_WIN}\\`, `${OLD_WIN}`)).toThrow()
  })

  test("tolerates trailing separators and mixed separator styles in inputs", () => {
    const rw = createPathRewriter(`${OLD_WIN}\\`, NEW_WIN)
    expect(rw.rewrite(`cd ${OLD_WIN}/tests`)).toBe(`cd ${NEW_WIN}/tests`)
    const mixed = createPathRewriter("C:/Users\\skele\\Documents/auto-resume", NEW_WIN)
    expect(mixed.rewrite("C:\\Users\\skele\\Documents\\auto-resume")).toBe(NEW_WIN)
  })

  test("unicode neighbors cannot bypass the boundary guard", () => {
    const rw = createPathRewriter("/home/user/Documents/proj", "/home/user/Documents/proj2")
    // unicode letter directly glued to the first component is a different token
    const glued = "/home/useréDocuments/proj"
    expect(rw.matches(glued)).toBe(false)
    const neighbor = "/home/usérr/Documents/proj"
    expect(rw.matches(neighbor)).toBe(false)
    expect(rw.rewrite(neighbor)).toBe(neighbor)
  })

  test("performance smoke: 1MB mixed-depth text rewrites fast", () => {
    const rw = createPathRewriter(OLD_WIN, NEW_WIN)
    const chunk = [
      `"p":"${OLD_WIN}"`,
      '"q":"C:\\\\Users\\\\skele\\\\Documents\\\\auto-resume\\\\f.js"',
      '"r":"lorem ipsum dolor sit amet"',
    ].join(",")
    const big = chunk.repeat(Math.ceil(1_000_000 / chunk.length))
    const started = performance.now()
    const out = rw.rewrite(big)
    const elapsed = performance.now() - started
    expect(out.toLowerCase()).not.toContain("documents\\auto-resume")
    expect(elapsed).toBeLessThan(500)
  })
})
