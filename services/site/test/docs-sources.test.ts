import { expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { docsTranslation } from "../src/docs/lib/navigation"
import { docsSource } from "../src/docs/lib/sources"
import { readHeadings } from "../src/docs/vite"

// A translation of a folder index page (`content/zh/build/index.mdx`) and its English source
// (`content/build/index.mdx`) share the slug `build`; headings and stale detection must find it.
function fixture() {
  const root = mkdtempSync(path.join(tmpdir(), "docs-source-"))
  mkdirSync(path.join(root, "build"), { recursive: true })
  mkdirSync(path.join(root, "zh/build"), { recursive: true })
  writeFileSync(
    path.join(root, "build/index.mdx"),
    '---\ntitle: "Build"\ndescription: "Build on OpenCode."\n---\n\n## Plugins\n\n### Server\n\n## SDK\n',
  )
  writeFileSync(path.join(root, "zh/build/index.mdx"), '---\ntitle: "构建"\n---\n\n## 插件\n\n### 服务器\n\n## SDK\n')
  return root
}

test("a translated folder index page resolves to its English folder index", () => {
  const root = fixture()
  try {
    expect(docsTranslation("zh/build/index.mdx")).toEqual({ locale: "zh", slug: "build" })
    expect(docsSource(root, "build")).toBe(path.join(root, "build/index.mdx"))
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test("readHeadings reads the English folder index page's headings", async () => {
  const root = fixture()
  try {
    expect(await readHeadings("build", root)).toEqual({ ids: ["plugins", "server", "sdk"], depths: [2, 3, 2] })
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
