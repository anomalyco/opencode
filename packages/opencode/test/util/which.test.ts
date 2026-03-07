import { describe, expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { which } from "../../src/util/which"
import { tmpdir } from "../fixture/fixture"

async function cmd(dir: string, name: string, exec = true) {
  const ext = process.platform === "win32" ? ".cmd" : ""
  const file = path.join(dir, name + ext)
  const body = process.platform === "win32" ? "@echo off\r\n" : "#!/bin/sh\n"
  await fs.writeFile(file, body)
  if (process.platform !== "win32") {
    await fs.chmod(file, exec ? 0o755 : 0o644)
  }
  return file
}

function env(PATH: string): NodeJS.ProcessEnv {
  return {
    PATH,
    PATHEXT: process.env["PATHEXT"],
  }
}

function envPath(Path: string): NodeJS.ProcessEnv {
  return {
    Path,
    PathExt: process.env["PathExt"] ?? process.env["PATHEXT"],
  }
}

function same(a: string | null, b: string) {
  if (process.platform === "win32") {
    expect(a?.toLowerCase()).toBe(b.toLowerCase())
    return
  }

  expect(a).toBe(b)
}

describe("util.which", () => {
  test("returns null when command is missing", () => {
    expect(which("opencode-missing-command-for-test")).toBeNull()
  })

  test("finds a command from PATH override", async () => {
    await using tmp = await tmpdir()
    const bin = path.join(tmp.path, "bin")
    await fs.mkdir(bin)
    const file = await cmd(bin, "tool")

    same(which("tool", env(bin)), file)
  })

  test("uses first PATH match", async () => {
    await using tmp = await tmpdir()
    const a = path.join(tmp.path, "a")
    const b = path.join(tmp.path, "b")
    await fs.mkdir(a)
    await fs.mkdir(b)
    const first = await cmd(a, "dupe")
    await cmd(b, "dupe")

    same(which("dupe", env([a, b].join(path.delimiter))), first)
  })

  test("returns null for non-executable file on unix", async () => {
    if (process.platform === "win32") return

    await using tmp = await tmpdir()
    const bin = path.join(tmp.path, "bin")
    await fs.mkdir(bin)
    await cmd(bin, "noexec", false)

    expect(which("noexec", env(bin))).toBeNull()
  })

  test("uses PATHEXT on windows", async () => {
    if (process.platform !== "win32") return

    await using tmp = await tmpdir()
    const bin = path.join(tmp.path, "bin")
    await fs.mkdir(bin)
    const file = path.join(bin, "pathext.CMD")
    await fs.writeFile(file, "@echo off\r\n")

    expect(which("pathext", { PATH: bin, PATHEXT: ".CMD" })).toBe(file)
  })

  test("uses Windows Path casing fallback", async () => {
    if (process.platform !== "win32") return

    await using tmp = await tmpdir()
    const bin = path.join(tmp.path, "bin")
    await fs.mkdir(bin)
    const file = await cmd(bin, "mixed")

    same(which("mixed", envPath(bin)), file)
  })
})
