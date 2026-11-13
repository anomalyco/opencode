import { $ } from "bun"
import { afterEach, describe, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { pack } from "../src/pack"

const cleanup: string[] = []

afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((file) => rm(file, { recursive: true, force: true })))
})

describe("pack", () => {
  test("lists each TypeScript export's types before its import", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "opencode-pack-"))
    cleanup.push(directory)
    await Bun.write(path.join(directory, "src/button.tsx"), "export const Button = 1\n")
    await Bun.write(path.join(directory, "src/button.css"), "button {}\n")
    await Bun.write(
      path.join(directory, "package.json"),
      JSON.stringify({
        name: "@opencode/pack-fixture",
        version: "0.0.0-test",
        type: "module",
        scripts: { build: "true" },
        files: ["src"],
        exports: { "./button": "./src/button.tsx", "./button.css": "./src/button.css" },
      }),
    )

    const tarball = await pack(directory, { source: true })
    cleanup.push(tarball)
    // A relative name, since Windows' GNU tar reads the `C:` in an absolute path as a remote host.
    const manifest = JSON.parse(
      await $`tar -xOzf ${path.basename(tarball)} package/package.json`.cwd(path.dirname(tarball)).text(),
    )

    expect(manifest.exports["./button"]).toEqual({ types: "./dist/button.d.ts", import: "./src/button.tsx" })
    expect(Object.keys(manifest.exports["./button"])).toEqual(["types", "import"])
    expect(manifest.exports["./button.css"]).toBe("./src/button.css")
  })
})
