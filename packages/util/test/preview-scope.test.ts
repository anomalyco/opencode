import { expect, test } from "bun:test"
import { previewAllowed } from "../src/preview-scope.js"

test.each([
  ["/home/u/repo", "/home/u", "/"],
  ["C:\\Users\\U\\repo", "C:\\Users\\U", "\\"],
])("document scope on %s", (root, home, sep) => {
  const allowed = (doc: string, path: string, entry = false) =>
    previewAllowed(root, doc.replaceAll("/", sep), path.replaceAll("/", sep), entry, home)
  for (const doc of ["index.html", "dist/index.htm"]) {
    const dir = doc.slice(0, doc.lastIndexOf("/") + 1)
    expect(allowed(doc, dir + "assets/main.js")).toBe(true)
    for (const file of [
      ".env",
      ".git/config",
      "assets/.hidden/ok.js",
      "keys/id_ed25519",
      "private.pem",
      "A.P12",
      "secrets.json",
      "credentials",
    ])
      expect(allowed(doc, dir + file)).toBe(false)
  }
  expect(allowed("dist/index.html", "assets/main.js")).toBe(false)
  expect(allowed("dist/index.html", "data.json")).toBe(false)
  expect(allowed(".well-known/index.html", ".well-known/index.html", true)).toBe(true)
  expect(allowed(".well-known/index.html", ".well-known/index.html")).toBe(false)
  expect(allowed(".well-known/index.html", ".well-known/x.html", true)).toBe(false)
  expect(allowed(".env", ".env", true)).toBe(false)
  expect(previewAllowed(home, "index.html", "other.txt", false, home)).toBe(false)
  expect(previewAllowed(home, "site/index.html", "site/assets/x", false, home)).toBe(true)
})
