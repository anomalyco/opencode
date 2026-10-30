import { expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { verifyBundles } from "./verify-bundles"

const cases = [
  {
    name: "valid main ESM chunks and CommonJS preload",
    files: {
      "main/index.js": 'import { app } from "electron"\nexport const ready = app.whenReady()\n',
      "main/pane-abc123.js":
        'import { createRequire } from "node:module"\nconst require = createRequire(import.meta.url)\nexport const http = require("node:http")\n',
      "preload/index.cjs": '"use strict"\nconst { contextBridge } = require("electron")\nmodule.exports = { contextBridge }\n//# sourceMappingURL=index.cjs.map',
    },
    error: undefined,
  },
  {
    name: "duplicate top-level identifier in a lazy main chunk",
    files: {
      "main/index.js": 'export const ok = true\n',
      "main/pane-abc123.js":
        'import m from "node:module";const n=m.createRequire(import.meta.url);var n=m.createRequire(import.meta.url);export{n};',
      "preload/index.cjs": 'module.exports = {}\n',
    },
    error: /main\/pane-abc123\.js/,
  },
  {
    name: "ESM syntax emitted into the CommonJS preload bundle",
    files: {
      "main/index.js": 'export const ok = true\n',
      "preload/index.cjs": 'export const preload = true\n',
    },
    error: /preload\/index\.cjs/,
  },
  {
    name: "missing preload output",
    files: {
      "main/index.js": 'export const ok = true\n',
    },
    error: /Expected built chunks/,
  },
] as const

test.each(cases)("verifyBundles handles $name", async (entry) => {
  const dir = await mkdtemp(path.join(tmpdir(), "opencode-verify-bundles-"))

  try {
    await Promise.all(
      Object.entries(entry.files).map(([rel, content]) => Bun.write(path.join(dir, rel), content)),
    )

    if (!entry.error) {
      await expect(verifyBundles(dir)).resolves.toBeUndefined()

      return
    }

    await expect(verifyBundles(dir)).rejects.toThrow(entry.error)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
