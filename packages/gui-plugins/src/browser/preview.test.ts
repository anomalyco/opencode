import { expect, test } from "bun:test"
import { previewAddress, previewFile, previewResource, reloadAddress } from "./preview"

const roots = ["/work/repo #1"]

const file = "file:///work/repo%20%231/index.html?q=1#anchor"

const view = "oc-preview://first/work/repo%20%231/index.html?q=1#anchor"

test("reload chooses the shown preview file for a virtual route, otherwise lets Chromium reload", () => {
  expect(reloadAddress(view.replace("index.html", "virtual"), file, "first", roots)).toBe(file)
  expect(reloadAddress(view, file, "first", roots)).toBeUndefined()
  expect(reloadAddress("https://example.com", file, "first", roots)).toBeUndefined()
})

test("a workspace address round-trips without ever loading a native file origin", () => {
  expect(previewAddress(file, "first", roots)).toBe(view)
  expect(previewFile(view, "first", roots)).toBe(file)
  expect(previewFile(view, "second", roots)).toBeUndefined()
  expect(previewFile("oc-preview://first/work/other/notes.html", "first", roots)).toBeUndefined()
  expect(previewAddress(file, undefined, roots)).toBeUndefined()
  expect(previewAddress(file, "first", [])).toBeUndefined()
})

test("a file path ending in a slash is not a regular file request on any platform", () => {
  expect(previewResource(view.replace(".html?", ".html/?"), "first", undefined, roots)).toBeUndefined()
})

test("preview documents and workers can only request their own origin and workspace", () => {
  expect(previewResource(view, "first", undefined, roots)).toBe(file)
  expect(previewResource(view, "first", "oc-preview://first", roots)).toBe(file)

  for (const origin of ["null", "file://", "https://example.org", "chrome-extension://abc", "oc-preview://second"])
    expect(previewResource(view, "first", origin, roots)).toBeUndefined()

  for (const url of [file, view.replace("/index", "/../index"), view.replace("/work/", "//work/"), view.replace("first", "second")])
    expect(previewResource(url, "first", undefined, roots)).toBeUndefined()
})

test("preview authority and path syntax have one interpretation before touching disk", () => {
  for (const authority of ["user:pass@first", "first:44", "second", ""])
    expect(previewFile(view.replace("//first", `//${authority}`), "first", roots)).toBeUndefined()

  for (const component of ["%2e%2e/out", "a%2Fb", "a%5cb", "%zz", "%C3", "%00", "foo\\bar"])
    expect(previewFile(view.replace("index.html", component), "first", roots)).toBeUndefined()

  expect(previewFile(view.replace("index.html", "%252e%252e"), "first", roots)).toContain("%252e%252e")
})

test.if(process.platform === "win32")("Windows aliases and device paths do not identify preview files", () => {
  const prefix = "oc-preview://host/c:/repo/"
  const roots = ["C:\\repo"]
  expect(previewFile(`${prefix}x`, "host", roots)).toBe("file:///c:/repo/x")

  for (const name of ["x:stream", "x::$DATA", "D:/x", "CON.txt", "NUL", "COM1.js", "x.", "x%20"])
    expect(previewFile(prefix + name, "host", roots)).toBeUndefined()

  for (const path of ["D:/repo/x", "/server/share/x", "%5c%5c%3f%5cc:/repo/x"])
    expect(previewFile(`oc-preview://host/${path}`, "host", roots)).toBeUndefined()
})
