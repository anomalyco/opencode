import { afterEach, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, writeFileSync } from "fs"
import { tmpdir } from "os"
import path from "path"
import { ShellSelect } from "@opencode/core/shell/select"

const savedPath = process.env.PATH
const savedPathAlt = process.env.Path

afterEach(() => {
  process.env.PATH = savedPath
  process.env.Path = savedPathAlt
})

function layout(folders: string[], git: string, bash: string) {
  const root = mkdtempSync(path.join(tmpdir(), "gitbash-"))
  for (const folder of folders) mkdirSync(path.join(root, folder), { recursive: true })
  writeFileSync(path.join(root, git), "git")
  writeFileSync(path.join(root, bash), "bash")
  return root
}

function use(dir: string) {
  process.env.PATH = dir
  process.env.Path = dir
}

const windows = process.platform === "win32"

describe("gitbash", () => {
  test("finds bash from Git cmd, mingw64, and MSYS2 git", () => {
    if (!windows) return
    const gitForWindows = layout(["cmd", "bin", "mingw64/bin"], "mingw64/bin/git.exe", "bin/bash.exe")
    writeFileSync(path.join(gitForWindows, "cmd/git.exe"), "git")
    const bash = path.join(gitForWindows, "bin/bash.exe")

    use(path.join(gitForWindows, "mingw64/bin"))
    expect(path.normalize(ShellSelect.gitbash() ?? "")).toBe(path.normalize(bash))

    use(path.join(gitForWindows, "cmd"))
    expect(path.normalize(ShellSelect.gitbash() ?? "")).toBe(path.normalize(bash))

    const msys = layout(["ucrt64/bin", "usr/bin"], "ucrt64/bin/git.exe", "usr/bin/bash.exe")
    use(path.join(msys, "ucrt64/bin"))
    expect(path.normalize(ShellSelect.gitbash() ?? "")).toBe(path.normalize(path.join(msys, "usr/bin/bash.exe")))
  })

  test("returns nothing when the install has no bash.exe", () => {
    if (!windows) return
    const root = mkdtempSync(path.join(tmpdir(), "gitbash-"))
    mkdirSync(path.join(root, "cmd"))
    writeFileSync(path.join(root, "cmd/git.exe"), "git")
    use(path.join(root, "cmd"))
    expect(ShellSelect.gitbash()).toBeUndefined()
    expect(ShellSelect.gitbash()).toBeUndefined()
  })
})
