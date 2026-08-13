import { afterEach, describe, expect, test } from "vitest"
import { mkdir, mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  commitScriptProject,
  hasGitMetadata,
  initializeScriptProject,
  stripGitEnvironment,
} from "../src/script/project.js"

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe("script project", () => {
  test("creates a clean Git baseline containing the declared files", async () => {
    const root = await temporary()
    await mkdir(join(root, ".git"))
    await initializeScriptProject(root, {
      git: true,
      files: { "src/example.ts": "export const value = 1\n" },
    })
    await commitScriptProject(root)

    expect(await Bun.file(join(root, "src/example.ts")).text()).toBe("export const value = 1\n")
    expect(await git(root, ["status", "--porcelain"])).toBe("")
    expect((await git(root, ["log", "-1", "--format=%s"])).trim()).toBe("Initial commit")
  })

  test("writes project files without requiring Git", async () => {
    const root = await temporary()
    await initializeScriptProject(root, { files: { "notes.txt": "hello\n" } })
    expect(await Bun.file(join(root, "notes.txt")).text()).toBe("hello\n")
    expect(await Bun.file(join(root, ".git")).exists()).toBe(false)
  })

  test("rejects files outside the project and Git metadata", async () => {
    const root = await temporary()
    await Bun.write(join(root, "existing.txt"), "before\n")
    await expect(
      initializeScriptProject(root, {
        files: { "../outside.ts": "no", "existing.txt": "after\n" },
      }),
    ).rejects.toThrow("stay inside")
    expect(await Bun.file(join(root, "existing.txt")).text()).toBe("before\n")
    await expect(initializeScriptProject(root, { files: { ".GIT/config": "no" } })).rejects.toThrow(
      "must not modify Git metadata",
    )
  })

  test("rejects fixture paths that resolve to the same file", async () => {
    const root = await temporary()
    await expect(
      initializeScriptProject(root, {
        files: { "same.txt": "one", "./same.txt": "two" },
      }),
    ).rejects.toThrow("must resolve to unique files")
    expect(await Bun.file(join(root, "same.txt")).exists()).toBe(false)
  })

  test("rejects path-tree conflicts before writing any files", async () => {
    const root = await temporary()
    await expect(
      initializeScriptProject(root, {
        files: {
          "good.txt": "must not be written",
          parent: "file",
          "parent/child": "child",
        },
      }),
    ).rejects.toThrow("file and directory conflicts")
    expect(await Bun.file(join(root, "good.txt")).exists()).toBe(false)
    await expect(initializeScriptProject(root, { files: { "": "no" } })).rejects.toThrow("must name a file")
    await mkdir(join(root, "directory"))
    await expect(
      initializeScriptProject(root, {
        files: { directory: "no", "still-good.txt": "no" },
      }),
    ).rejects.toThrow("must not be a directory")
    expect(await Bun.file(join(root, "still-good.txt")).exists()).toBe(false)
  })

  test("refuses to replace prepared Git metadata", async () => {
    const root = await temporary()
    await mkdir(join(root, ".git"))
    await Bun.write(join(root, ".git", "config"), "[core]\n")
    await expect(
      initializeScriptProject(root, {
        git: true,
        files: { "must-not-be-written.txt": "no\n" },
      }),
    ).rejects.toThrow("cannot replace existing Git metadata")
    expect(await Bun.file(join(root, "must-not-be-written.txt")).exists()).toBe(false)
  })

  test("removes inherited Git environment variables", () => {
    expect(
      stripGitEnvironment({
        PATH: "/bin",
        GIT_DIR: "/outside",
        EMPTY: undefined,
      }),
    ).toEqual({
      PATH: "/bin",
    })
  })

  test("detects prepared repositories but ignores the empty Drive placeholder", async () => {
    const root = await temporary()
    await mkdir(join(root, ".git"))
    expect(await hasGitMetadata(root)).toBe(false)
    await Bun.write(join(root, ".git", "HEAD"), "ref: refs/heads/main\n")
    expect(await hasGitMetadata(root)).toBe(true)
  })
})

async function temporary() {
  const root = await mkdtemp(join(tmpdir(), "opencode-drive-project-test-"))
  roots.push(root)
  return root
}

async function git(cwd: string, args: ReadonlyArray<string>) {
  return Bun.$`git ${args}`.cwd(cwd).text()
}
