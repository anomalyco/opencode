import { expect, test } from "bun:test"
import { webHref } from "./web-href"

test("network-path and explicit web links enter the same session link policy", () => {
  const base = "https://session.test/base/"
  expect(webHref("//other.test/path", base)).toBe("https://other.test/path")
  expect(webHref("http://other.test/path", base)).toBe("http://other.test/path")

  for (const path of ["/api/file", "report.html", "#part", "///etc/x", "//\\host/file", "file:///x"])
    expect(webHref(path, base)).toBeUndefined()
})
