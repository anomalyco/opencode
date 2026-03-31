import { describe, expect, test } from "bun:test"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { pathToFileURL } from "url"
import { resolveNutJsImportSpecifier } from "../../src/tool/desktop"

describe("resolveNutJsImportSpecifier", () => {
  test("uses a real on-disk helper when running from Bun's compiled filesystem", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-desktop-"))
    const execPath = path.join(tempDir, "opencode")
    const helperPath = path.join(tempDir, "desktop.runtime.mjs")

    await fs.writeFile(execPath, "")
    await fs.writeFile(helperPath, "export default { marker: 'desktop-runtime-helper' }")

    const specifier = resolveNutJsImportSpecifier("file:///$bunfs/root/src/cli/cmd/tui/worker.js", execPath)
    const expectedHelperPath = pathToFileURL(await fs.realpath(helperPath)).href

    expect(specifier).toBe(expectedHelperPath)

    const loaded = await import(specifier)
    expect(loaded.default.marker).toBe("desktop-runtime-helper")
  })

  test("uses the package import during normal source runtime", () => {
    expect(resolveNutJsImportSpecifier("file:///tmp/opencode/src/tool/desktop.ts", "/usr/local/bin/bun")).toBe(
      "@nut-tree-fork/nut-js",
    )
  })
})
