import { afterEach, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { retainAssets } from "../script/retain-assets"

const day = 24 * 60 * 60 * 1000
const dirs: string[] = []
afterEach(() => Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))))

async function build(files: Record<string, string>) {
  const dir = await mkdtemp(path.join(tmpdir(), "retain-assets-"))
  dirs.push(dir)
  await Promise.all(Object.entries(files).map(([file, text]) => Bun.write(path.join(dir, file), text)))
  return dir
}

function serve(files: Record<string, string>) {
  return Bun.serve({
    port: 0,
    fetch: (request) => {
      const file = files[new URL(request.url).pathname.slice(1)]
      return file === undefined ? new Response("not found", { status: 404 }) : new Response(file)
    },
  })
}

test("carries the replaced build's hashed files and the earlier ones still in their window", async () => {
  const recent = new Date(Date.now() - day).toISOString()
  const expired = new Date(Date.now() - 8 * day).toISOString()
  using server = serve({
    "_build/retained.json": JSON.stringify({
      live: ["_build/assets/page-old.js", "_build/assets/shared-same.js", "docs/_build/docs-old.css"],
      retired: {
        "_build/assets/older-recent.js": recent,
        "_build/assets/oldest-expired.js": expired,
        "_build/assets/gone.js": recent,
      },
    }),
    "_build/assets/page-old.js": "old page",
    "_build/assets/shared-same.js": "shared",
    "docs/_build/docs-old.css": "old docs",
    "_build/assets/older-recent.js": "older",
    "_build/assets/oldest-expired.js": "oldest",
  })
  const assets = await build({
    "_build/assets/page-new.js": "new page",
    "_build/assets/shared-same.js": "shared",
    "index.html": "<html>",
  })

  await retainAssets(assets, server.url.origin)

  expect(await Bun.file(path.join(assets, "_build/assets/page-old.js")).text()).toBe("old page")
  expect(await Bun.file(path.join(assets, "docs/_build/docs-old.css")).text()).toBe("old docs")
  expect(await Bun.file(path.join(assets, "_build/assets/older-recent.js")).text()).toBe("older")
  expect(await Bun.file(path.join(assets, "_build/assets/oldest-expired.js")).exists()).toBe(false)
  const ledger = await Bun.file(path.join(assets, "_build/retained.json")).json()
  expect(ledger.live.toSorted()).toEqual(["_build/assets/page-new.js", "_build/assets/shared-same.js"])
  expect(Object.keys(ledger.retired).toSorted()).toEqual([
    "_build/assets/older-recent.js",
    "_build/assets/page-old.js",
    "docs/_build/docs-old.css",
  ])
  expect(ledger.retired["_build/assets/older-recent.js"]).toBe(recent)
  expect(Date.now() - Date.parse(ledger.retired["_build/assets/page-old.js"])).toBeLessThan(60_000)
})

test("keeps at most the last 20 replaced builds", async () => {
  const retired = Object.fromEntries(
    Array.from({ length: 21 }, (_, index) => [
      `_build/assets/build-${index}.js`,
      new Date(Date.now() - (21 - index) * 60_000).toISOString(),
    ]),
  )
  using server = serve({
    "_build/retained.json": JSON.stringify({ live: ["_build/assets/_..-live.css"], retired }),
    "_build/assets/_..-live.css": "live",
    ...Object.fromEntries(Object.keys(retired).map((file) => [file, file])),
  })
  const assets = await build({ "index.html": "<html>" })

  await retainAssets(assets, server.url.origin)

  const kept = Object.keys((await Bun.file(path.join(assets, "_build/retained.json")).json()).retired)
  expect(kept).toHaveLength(20)
  expect(kept).toContain("_build/assets/_..-live.css")
  expect(kept).not.toContain("_build/assets/build-0.js")
  expect(kept).not.toContain("_build/assets/build-1.js")
  expect(await Bun.file(path.join(assets, "_build/assets/build-1.js")).exists()).toBe(false)
})

test("carries nothing when the live site has no list, and never files that aren't hashed", async () => {
  using empty = serve({})
  const first = await build({ "_build/assets/a.js": "a", "index.html": "<html>" })
  await retainAssets(first, empty.url.origin)
  expect(await Bun.file(path.join(first, "_build/retained.json")).json()).toEqual({
    live: ["_build/assets/a.js"],
    retired: {},
  })

  using garbled = serve({ "_build/retained.json": "<html>" })
  await retainAssets(first, garbled.url.origin)
  expect((await Bun.file(path.join(first, "_build/retained.json")).json()).retired).toEqual({})

  using tampered = serve({
    "_build/retained.json": JSON.stringify({ live: ["index.html", "_build/assets/../../escape.js"], retired: {} }),
    "index.html": "<old html>",
  })
  const second = await build({ "index.html": "<html>" })
  await retainAssets(second, tampered.url.origin)
  expect(await Bun.file(path.join(second, "index.html")).text()).toBe("<html>")
  expect((await Bun.file(path.join(second, "_build/retained.json")).json()).retired).toEqual({})
})
