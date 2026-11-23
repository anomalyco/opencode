import { expect, test } from "bun:test"
import { createRequire } from "node:module"
import path from "node:path"
import { tmpdir } from "./fixture/tmpdir"

// Regression test for https://github.com/anomalyco/opencode/issues/65763.
//
// Updating a private Git plugin fetches a hosted tarball first and falls back
// to a git clone over SSH when that fetch fails with an HTTP error. Upstream
// pacote picks the fallback with `er.constructor.name.match(/^Http/)`, which
// breaks once the shipped binaries minify npm code and rename the error
// class. The workspace carries a patch (patches/pacote@*.patch) that checks
// `er.statusCode` instead, which survives minification. Bundle the real
// pacote git fetcher with the CLI's production minify setting and fail if the
// fragile class-name check ever reaches a shipped bundle again, for example
// by the patch going missing on the next pacote bump.
test("minified pacote git fallback does not depend on error class names", async () => {
  const utilPkg = path.resolve(import.meta.dirname, "..", "..", "util", "package.json")
  const gitJs = createRequire(utilPkg).resolve("pacote/lib/git.js")

  await using root = await tmpdir()
  await Bun.write(path.join(root.path, "entry.ts"), `import ${JSON.stringify(gitJs)}\n`)
  // Mirrors the bundling options in packages/cli/script/build.ts.
  const result = await Bun.build({
    entrypoints: [path.join(root.path, "entry.ts")],
    outdir: path.join(root.path, "out"),
    format: "esm",
    target: "bun",
    external: ["node-gyp"],
    minify: true,
  })
  expect(result.success).toBe(true)
  const bundle = await Bun.file(path.join(root.path, "out", "entry.js")).text()
  expect(bundle).not.toContain("constructor.name.match")
  expect(bundle).toMatch(/typeof \w+\.statusCode==="number"&&\w+\.statusCode>=400/)
})
