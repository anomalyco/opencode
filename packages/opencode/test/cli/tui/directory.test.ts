import { afterEach, describe, expect, test } from "bun:test"
import { Dir } from "../../../src/cli/cmd/tui/directory"
import { tmpdir } from "../../fixture/fixture"

const cwd = process.cwd()
const pwd = process.env.PWD

afterEach(() => {
  process.chdir(cwd)
  if (pwd === undefined) delete process.env.PWD
  else process.env.PWD = pwd
})

describe("tui directory", () => {
  test("canonicalizes macOS temp PWD aliases", async () => {
    if (process.platform !== "darwin") return
    await using tmp = await tmpdir()
    if (!tmp.path.startsWith("/private/var/")) return
    const alias = tmp.path.replace("/private/var/", "/var/")

    process.env.PWD = alias

    expect(Dir.project()).toBe(tmp.path)
    expect(process.cwd()).toBe(tmp.path)
  })

  test("canonicalizes explicit macOS temp directories", async () => {
    if (process.platform !== "darwin") return
    await using tmp = await tmpdir()
    if (!tmp.path.startsWith("/private/var/")) return
    const alias = tmp.path.replace("/private/var/", "/var/")

    expect(Dir.enter(alias)).toBe(tmp.path)
    expect(process.cwd()).toBe(tmp.path)
  })
})
