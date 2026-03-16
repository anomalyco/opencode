import { afterEach, describe, expect, test } from "bun:test"
import { $ } from "bun"
import { Instance } from "../../src/project/instance"
import { Vcs } from "../../src/project/vcs"
import { tmpdir } from "../fixture/fixture"

afterEach(async () => {
  await Instance.disposeAll()
})

describe("Vcs.info", () => {
  test("returns no branch data when git is detached at HEAD", async () => {
    await using tmp = await tmpdir({ git: true })
    await $`git checkout --detach HEAD`.cwd(tmp.path).quiet()

    const info = await Instance.provide({
      directory: tmp.path,
      fn: async () => Vcs.info(),
    })

    expect(info.branch).toBe("")
    expect(info.defaultBranch).toBeUndefined()
    expect(info.branches).toBeUndefined()
    expect(info.github).toBeUndefined()
    expect(info.pr).toBeUndefined()
  })
})
