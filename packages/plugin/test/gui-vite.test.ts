import { afterAll, expect, test } from "bun:test"
import { mkdtemp, readdir, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { build } from "vite"
import { pluginSharedModules, pluginWindowModules } from "../src/gui/host"
import { gui } from "../src/gui/vite"

const dirs: string[] = []

afterAll(() => Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true }))))

const project = async (files: Record<string, string>) => {
  const root = await mkdtemp(path.join(tmpdir(), "opencode-gui-vite-"))
  dirs.push(root)
  await Promise.all(Object.entries(files).map(([file, text]) => Bun.write(path.join(root, file), text)))

  return root
}

const bundle = (root: string) => build({ root, configFile: false, logLevel: "silent", plugins: gui() })

test("the preset writes one CommonJS file that requires only what the app provides", async () => {
  const hosted = [...pluginSharedModules, ...pluginWindowModules]
  const root = await project({
    "src/gui.tsx": [
      ...hosted.map((name, index) => `import * as m${index} from "${name}"`),
      'import { readFileSync } from "node:fs"',
      'import { app } from "electron"',
      'const Page = m0 && (() => import("./page"))',
      `export default { id: "acme", modules: [${hosted.map((_, index) => `m${index}`).join(", ")}], readFileSync, app, Page }`,
    ].join("\n"),
    "src/page.tsx": "export default () => <p>Notes</p>",
  })

  await bundle(root)
  const code = await Bun.file(path.join(root, "dist/gui-experimental.cjs")).text()
  const required = new Set(Array.from(code.matchAll(/require\("([^"]+)"\)/g), (match) => match[1]))

  // The page is inlined, not a second chunk the app would never load.
  expect(await readdir(path.join(root, "dist"))).toEqual(["gui-experimental.cjs"])
  expect(code).toContain("Notes")
  expect([...required].sort()).toEqual([...hosted, "electron", "node:fs"].sort())
}, 60_000)

test("the preset fails the build on an OpenCode, Effect or Solid module the app does not provide", async () => {
  const root = await project({
    "src/gui.tsx": 'import { Schema } from "effect/Schema"\nexport default { id: "acme", Schema }',
  })

  await expect(bundle(root)).rejects.toThrow("effect/Schema is not a module the OpenCode app provides")
}, 60_000)
