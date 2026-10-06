import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import fs from "fs"
import os from "os"
import path from "path"
import { Glob } from "../src/glob.js"

describe("Glob.scan", () => {
  let root: string

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "opencode-glob-"))
    fs.mkdirSync(path.join(root, "agent", "node_modules", "probe"), { recursive: true })
    fs.mkdirSync(path.join(root, "agent", "team"), { recursive: true })
    fs.writeFileSync(path.join(root, "agent", "root.md"), "root")
    fs.writeFileSync(path.join(root, "agent", "team", "helper.md"), "helper")
    fs.writeFileSync(path.join(root, "agent", "node_modules", "probe", "README.md"), "dependency")
  })

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true })
  })

  test("finds all Markdown including node_modules when no ignore is given", async () => {
    const files = await Glob.scan("{agent,agents}/**/*.md", {
      cwd: root,
      absolute: true,
      dot: true,
      symlink: true,
    })
    expect(files.toSorted()).toEqual(
      [
        path.join(root, "agent", "node_modules", "probe", "README.md"),
        path.join(root, "agent", "root.md"),
        path.join(root, "agent", "team", "helper.md"),
      ].toSorted(),
    )
  })

  test("prunes ignored directories during traversal", async () => {
    const files = await Glob.scan("{agent,agents}/**/*.md", {
      cwd: root,
      absolute: true,
      dot: true,
      symlink: true,
      ignore: ["**/node_modules/**"],
    })
    expect(files.toSorted()).toEqual(
      [path.join(root, "agent", "root.md"), path.join(root, "agent", "team", "helper.md")].toSorted(),
    )
  })

  test("still follows symlinked directories that are not ignored", async () => {
    const external = fs.mkdtempSync(path.join(os.tmpdir(), "opencode-glob-external-"))
    try {
      fs.mkdirSync(path.join(external, "linked"))
      fs.writeFileSync(path.join(external, "linked", "nested.md"), "nested")
      fs.symlinkSync(path.join(external, "linked"), path.join(root, "agent", "linked"))
      const files = await Glob.scan("{agent,agents}/**/*.md", {
        cwd: root,
        absolute: true,
        dot: true,
        symlink: true,
        ignore: ["**/node_modules/**"],
      })
      expect(files).toContain(path.join(root, "agent", "linked", "nested.md"))
    } finally {
      fs.rmSync(external, { recursive: true, force: true })
    }
  })
})
