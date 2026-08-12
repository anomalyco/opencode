import { afterEach, describe, expect, test } from "vitest"
import { mkdtemp, rm, symlink } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import * as Effect from "effect/Effect"
import { Errors } from "../src/index.js"
import { createScriptFileSystem } from "../src/script/filesystem.js"

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe("script filesystem", () => {
  test("writes relative files and creates their parents", async () => {
    const root = await temporary()
    const fs = createScriptFileSystem(root)
    await Effect.runPromise(fs.writeFile("src/nested/example.ts", "export const value = 1\n"))
    expect(await Bun.file(join(root, "src/nested/example.ts")).text()).toBe("export const value = 1\n")
  })

  test("rejects paths outside the project and symbolic links", async () => {
    const root = await temporary()
    const outside = await temporary()
    const fs = createScriptFileSystem(root)
    await symlink(outside, join(root, "linked"))

    const outsideError = await Effect.runPromise(
      fs.writeFile("../outside.ts", "no").pipe(Effect.flip),
    )
    expect(outsideError).toBeInstanceOf(Errors.FileSystemError)
    expect(outsideError).toMatchObject({
      _tag: "FileSystemError",
      path: "../outside.ts",
      message: expect.stringContaining("stay inside"),
    })
    await expect(Effect.runPromise(fs.writeFile(join(outside, "absolute.ts"), "no"))).rejects.toThrow("must be relative")
    await expect(Effect.runPromise(fs.writeFile("linked/outside.ts", "no"))).rejects.toThrow("must not contain symbolic links")
  })

  test("reserves Git metadata for declared Git projects", async () => {
    const root = await temporary()
    const fs = createScriptFileSystem(root, { git: true })
    await expect(Effect.runPromise(fs.writeFile(".GIT/config", "no"))).rejects.toThrow("must not modify Git metadata")
  })
})

async function temporary() {
  const root = await mkdtemp(join(tmpdir(), "opencode-drive-fs-test-"))
  roots.push(root)
  return root
}
