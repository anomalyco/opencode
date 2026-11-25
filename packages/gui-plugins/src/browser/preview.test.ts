import { expect, test } from "bun:test"
import { previewAddress, previewFile, previewResource, reloadAddress } from "./preview"
import { refusal } from "./policy"
import { navigationNotice } from "./refusal-notice"
import { fileTab, reusableFile, workspaceFileURL } from "./link"

const roots = ["/work/repo #1"]

const file = "file:///work/repo%20%231/index.html?q=1#anchor"

const view = "oc-preview://first/work/repo%20%231/index.html?q=1#anchor"

test("new-tab intent never matches the plain-open file key", () => {
  const url = "workspace://ses_x/site.html?view=2#top"
  expect(reusableFile(url, "new")).toBeUndefined()
  expect(reusableFile(url, "present")).toBe("workspace://ses_x/site.html")
  expect(reusableFile("https://example.test/", "present")).toBeUndefined()
})

test("a file the agent opens again goes to the tab that already shows it", () => {
  const page = workspaceFileURL("/work/repo #1", "site/index.html")

  const tabs = [
    { id: "web", url: "https://example.test/site/index.html" },
    { id: "other", url: workspaceFileURL("/work/repo #1", "site/other.html") },
    // The page moved within itself since it was opened: a query and a fragment do not make it another file.
    { id: "shown", url: `${page}?step=2#result` },
    { id: "second", url: page },
  ]

  expect(fileTab(tabs, page)?.id).toBe("shown")
  expect(fileTab(tabs, workspaceFileURL("/work/repo #1", "site/index.htm"))).toBeUndefined()
  // A remote server's file has its own address, so the same path in this machine's workspace is another file.
  expect(fileTab(tabs, workspaceFileURL("/work/repo #1", "site/index.html", "ses_x"))).toBeUndefined()
  expect(fileTab([{ id: "remote", url: "workspace://ses_x/site/index.html#top" }], workspaceFileURL("/work", "site/index.html", "ses_x"))?.id).toBe("remote")
})

test("a remote policy opens only its own session's workspace and explains a refusal as a workspace restriction", () => {
  const remote = "workspace://ses_x/"
  const address = `${remote}dir/page.html?q=1#h`
  const actual = "oc-preview://host/dir/page.html?q=1#h"
  expect(previewAddress(address, "host", [], remote)).toBe(actual)
  expect(previewFile(actual, "host", [], remote)).toBe(address)
  expect(refusal(address, {remote})).toBeUndefined()
  expect(refusal(address, {})).toBe("browser.address.web")

  for (const other of [file, "workspace://ses_other/dir/page.html"]) {
    expect(previewAddress(other, "host", roots, remote)).toBeUndefined()
    expect(refusal(other, {remote})).toBe("browser.address.workspace")
    expect(navigationNotice(other, {remote}).reason).toBe("browser.address.workspace")
  }
})

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
