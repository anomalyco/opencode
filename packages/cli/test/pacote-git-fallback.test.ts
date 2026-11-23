import { expect, test } from "bun:test"
import { createRequire } from "node:module"
import path from "node:path"

// Regression test related to https://github.com/anomalyco/opencode/issues/65763.
//
// Updating a private Git plugin fetches a hosted tarball first and falls back
// to a git clone over SSH when that fetch fails with an HTTP error. Upstream
// pacote picks the fallback with `er.constructor.name.match(/^Http/)`, which
// breaks once the shipped binaries minify npm code and rename the error
// class. The workspace carries a patch (patches/pacote@*.patch) that checks
// `er.statusCode` instead, which survives minification. Guard that the resolved
// pacote/lib/git.js keeps the statusCode check (e.g. if the patch goes missing
// on a future pacote bump).
test("pacote git fallback checks statusCode instead of error class name", async () => {
  const utilPkg = path.resolve(import.meta.dirname, "..", "..", "util", "package.json")
  const gitJs = createRequire(utilPkg).resolve("pacote/lib/git.js")
  const source = await Bun.file(gitJs).text()

  expect(source.includes("constructor.name.match")).toBe(false)
  expect(source.includes("typeof er.statusCode === 'number' && er.statusCode >= 400")).toBe(true)
})
