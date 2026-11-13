import { expect, test } from "bun:test"
import { previewAddress, previewFile, previewResource } from "./preview"

const roots = ["/work/repo #1"]

const file = "file:///work/repo%20%231/index.html?q=1#anchor"

const view = "oc-preview://first/work/repo%20%231/index.html?q=1#anchor"

test("a workspace address round-trips without ever loading a native file origin", () => {
  expect(previewAddress(file, "first", roots)).toBe(view)
  expect(previewFile(view, "first")).toBe(file)
  expect(previewFile(view, "second")).toBeUndefined()
  expect(previewAddress(file, undefined, roots)).toBeUndefined()
  expect(previewAddress(file, "first", [])).toBeUndefined()
})

test("preview documents and workers can only request their own origin and workspace", () => {
  expect(previewResource(view, "first", undefined, roots)).toBe(file)
  expect(previewResource(view, "first", "oc-preview://first", roots)).toBe(file)

  for (const origin of ["null", "file://", "https://example.org", "oc-preview://second"])
    expect(previewResource(view, "first", origin, roots)).toBeUndefined()

  for (const url of [file, view.replace("/index", "/../index"), view.replace("/work/", "//work/"), view.replace("first", "second")])
    expect(previewResource(url, "first", undefined, roots)).toBeUndefined()
})
