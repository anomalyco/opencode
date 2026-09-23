import { expect, test } from "bun:test"
import { allowedDestination, destinationOrigin, fileURLWithin, localFileURL, normalizeURL } from "./browser/policy"

test("allows cross-origin HTTP navigation but rejects unsafe destinations and embedded credentials", () => {
  expect(destinationOrigin("https://other.example/path")).toBe("https://other.example")
  expect(destinationOrigin("http://localhost:3000/")).toBe("http://localhost:3000")
  for (const url of [
    "file:///etc/passwd",
    "javascript:alert(1)",
    "data:text/html,test",
    "https://user:pass@example.com",
  ]) {
    expect(destinationOrigin(url)).toBeUndefined()
  }
})

test("file documents load only from allowed workspace roots and never from a host", () => {
  expect(localFileURL("file:///C:/work/out/report.html")).toBe("file:///C:/work/out/report.html")
  expect(localFileURL("file://server/share/report.html")).toBeUndefined()
  expect(localFileURL("https://example.com")).toBeUndefined()

  const roots = ["/home/me/repo"]
  expect(fileURLWithin("file:///home/me/repo/out/index.html", roots)).toBe(true)
  expect(fileURLWithin("file:///home/me/repo", roots)).toBe(true)
  expect(fileURLWithin("file:///home/me/repo-other/x.html", roots)).toBe(false)
  expect(fileURLWithin("file:///home/me/.aws/credentials", roots)).toBe(false)
  expect(fileURLWithin("file:///home/me/repo/../.aws/credentials", roots)).toBe(false)
  expect(fileURLWithin("file:///home/me/repo/out/%2e%2e/%2e%2e/.aws/credentials", roots)).toBe(false)
  expect(fileURLWithin("file:///home/me/repo/x.html", [])).toBe(false)
  expect(fileURLWithin("file://server/home/me/repo/x.html", roots)).toBe(false)

  expect(allowedDestination("file:///home/me/repo/x.html")).toBe(false)
  expect(allowedDestination("file:///home/me/repo/x.html", { fileRoots: roots })).toBe(true)
  expect(allowedDestination("file:///etc/passwd", { fileRoots: roots })).toBe(false)
  expect(allowedDestination("javascript:alert(1)", { fileRoots: roots })).toBe(false)

  expect(normalizeURL("file:///home/me/repo/x.html", { fileRoots: roots })).toBe("file:///home/me/repo/x.html")
  expect(() => normalizeURL("file:///home/me/repo/x.html")).toThrow()
  expect(() => normalizeURL("file:///etc/passwd", { fileRoots: roots })).toThrow()
  expect(normalizeURL("localhost:3000", { fileRoots: roots })).toBe("http://localhost:3000")
})

test("windows workspace roots match drive-letter file URLs", () => {
  const roots = ["C:\\Users\\me\\repo"]
  const inside = process.platform === "win32"
  expect(fileURLWithin("file:///C:/Users/me/repo/out/index.html", roots)).toBe(true)
  expect(fileURLWithin("file:///c:/users/me/repo/out/index.html", roots)).toBe(inside)
  expect(fileURLWithin("file:///C:/Users/me/repo2/x.html", roots)).toBe(false)
  expect(fileURLWithin("file:///D:/Users/me/repo/x.html", roots)).toBe(false)
})
