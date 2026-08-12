import { expect, test } from "bun:test"
import path from "path"
import { ReqWorkspace } from "../../src/product/req-workspace"
import { tmpdir } from "../fixture/fixture"

test("empty dir creates the three files and scores/.gitkeep", async () => {
  await using tmp = await tmpdir()
  const result = await ReqWorkspace.scaffold(tmp.path)
  expect(result.created).toEqual([
    ".moks/req/jd.md",
    ".moks/req/scorecard.md",
    ".moks/req/notes.md",
    ".moks/req/scores/.gitkeep",
  ])
  expect(await Bun.file(path.join(tmp.path, ".moks/req/jd.md")).text()).toBe(ReqWorkspace.JD_STUB)
  expect(await Bun.file(path.join(tmp.path, ".moks/req/scorecard.md")).text()).toBe(ReqWorkspace.SCORECARD_STUB)
  expect(await Bun.file(path.join(tmp.path, ".moks/req/notes.md")).text()).toBe(ReqWorkspace.NOTES_STUB)
  expect(await Bun.file(path.join(tmp.path, ".moks/req/scores/.gitkeep")).exists()).toBe(true)
})

test("second call does not overwrite non-empty jd.md", async () => {
  await using tmp = await tmpdir()
  await ReqWorkspace.scaffold(tmp.path)
  const jd = path.join(tmp.path, ".moks/req/jd.md")
  await Bun.write(jd, "# Staff Engineer\n")
  const result = await ReqWorkspace.scaffold(tmp.path)
  expect(result.skipped).toContain(".moks/req/jd.md")
  expect(await Bun.file(jd).text()).toBe("# Staff Engineer\n")
})

test("existing .gitignore without .moks/ gets the entry", async () => {
  await using tmp = await tmpdir()
  const gi = path.join(tmp.path, ".gitignore")
  await Bun.write(gi, "node_modules/\n")
  await ReqWorkspace.scaffold(tmp.path)
  expect(await Bun.file(gi).text()).toContain(".moks/")
})

test("does not create a gitignore when none exists", async () => {
  await using tmp = await tmpdir()
  await ReqWorkspace.scaffold(tmp.path)
  expect(await Bun.file(path.join(tmp.path, ".gitignore")).exists()).toBe(false)
})
