import { describe, expect, test } from "bun:test"
import path from "node:path"

const root = path.join(import.meta.dir, "..")
const manifest = await Bun.file(path.join(root, "package.json")).json()

function imports(file: string) {
  return [...file.matchAll(/@import\s+["'](.+?)["']/g)].map((match) => match[1])
}

describe("package", () => {
  test("all exports resolve to files", async () => {
    const targets = Object.values(manifest.exports) as string[]
    const concrete = targets.filter((target) => !target.includes("*"))
    expect(await Promise.all(concrete.map((target) => Bun.file(path.join(root, target)).exists()))).toEqual(
      concrete.map(() => true),
    )
  })

  test("all local CSS imports resolve", async () => {
    const files = [...new Bun.Glob("**/*.css").scanSync({ cwd: root, absolute: true })]
    const missing = (
      await Promise.all(
        files.map(async (file) =>
          Promise.all(
            imports(await Bun.file(file).text())
              .filter((target) => target.startsWith("."))
              .map(async (target) =>
                (await Bun.file(path.resolve(path.dirname(file), target)).exists()) ? undefined : target,
              ),
          ),
        ),
      )
    )
      .flat()
      .filter(Boolean)
    expect(missing).toEqual([])
  })

  test("component index includes every component once", async () => {
    const expected = [...new Bun.Glob("components/*.css").scanSync({ cwd: root })].sort()
    const actual = imports(await Bun.file(path.join(root, "components.css")).text())
      .map((target) => target.replace(/^\.\//, ""))
      .sort()
    expect(actual).toEqual(expected)
  })

  test("public CSS does not expose v2 names", async () => {
    const files = [...new Bun.Glob("**/*.css").scanSync({ cwd: root, absolute: true })]
    const stale = (
      await Promise.all(files.map(async (file) => ((await Bun.file(file).text()).includes("-v2") ? file : undefined)))
    ).filter(Boolean)
    expect(stale).toEqual([])
  })

  test("all referenced tokens are declared", async () => {
    const files = [...new Bun.Glob("**/*.css").scanSync({ cwd: root, absolute: true })]
    const css = (await Promise.all(files.map((file) => Bun.file(file).text()))).join("\n")
    const declared = new Set([...css.matchAll(/(--[\w-]+)\s*:/g)].map((match) => match[1]))
    const referenced = new Set([...css.matchAll(/var\((--[\w-]+)/g)].map((match) => match[1]))
    expect([...referenced].filter((token) => !declared.has(token)).sort()).toEqual([])
  })
})
