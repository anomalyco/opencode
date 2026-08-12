import { expect, test } from "bun:test"
import path from "path"
import { ReqWorkspace } from "../../src/product/req-workspace"
import { tmpdir } from "../fixture/fixture"

test("slugify lowercases and hyphenates", () => {
  expect(ReqWorkspace.slugify("Senior Backend Engineer")).toBe("senior-backend-engineer")
  expect(ReqWorkspace.slugify("  staff-ml  ")).toBe("staff-ml")
  expect(ReqWorkspace.slugify("!!!")).toBe("")
})

test("empty dir creates the three files and scores/.gitkeep under the slug", async () => {
  await using tmp = await tmpdir()
  const result = await ReqWorkspace.scaffold(tmp.path, "senior-backend")
  expect(result.created).toEqual([
    ".moks/reqs/senior-backend/jd.md",
    ".moks/reqs/senior-backend/scorecard.md",
    ".moks/reqs/senior-backend/notes.md",
    ".moks/reqs/senior-backend/scores/.gitkeep",
  ])
  expect(await Bun.file(path.join(tmp.path, ".moks/reqs/senior-backend/jd.md")).text()).toBe(ReqWorkspace.JD_STUB)
  expect(await Bun.file(path.join(tmp.path, ".moks/reqs/senior-backend/scorecard.md")).text()).toBe(
    ReqWorkspace.SCORECARD_STUB,
  )
  expect(await Bun.file(path.join(tmp.path, ".moks/reqs/senior-backend/notes.md")).text()).toBe(ReqWorkspace.NOTES_STUB)
  expect(await Bun.file(path.join(tmp.path, ".moks/reqs/senior-backend/scores/.gitkeep")).exists()).toBe(true)
})

test("second call does not overwrite non-empty jd.md", async () => {
  await using tmp = await tmpdir()
  await ReqWorkspace.scaffold(tmp.path, "senior-backend")
  const jd = path.join(tmp.path, ".moks/reqs/senior-backend/jd.md")
  await Bun.write(jd, "# Staff Engineer\n")
  const result = await ReqWorkspace.scaffold(tmp.path, "senior-backend")
  expect(result.skipped).toContain(".moks/reqs/senior-backend/jd.md")
  expect(await Bun.file(jd).text()).toBe("# Staff Engineer\n")
})

test("existing .gitignore without .moks/ gets the entry", async () => {
  await using tmp = await tmpdir()
  const gi = path.join(tmp.path, ".gitignore")
  await Bun.write(gi, "node_modules/\n")
  await ReqWorkspace.scaffold(tmp.path, "senior-backend")
  expect(await Bun.file(gi).text()).toContain(".moks/")
})

test("does not create a gitignore when none exists", async () => {
  await using tmp = await tmpdir()
  await ReqWorkspace.scaffold(tmp.path, "senior-backend")
  expect(await Bun.file(path.join(tmp.path, ".gitignore")).exists()).toBe(false)
})

test("list returns book slugs and a lone legacy req", async () => {
  await using tmp = await tmpdir()
  await ReqWorkspace.scaffold(tmp.path, "staff-ml")
  await ReqWorkspace.scaffold(tmp.path, "em-platform")
  await Bun.write(path.join(tmp.path, ".moks/req/jd.md"), "# legacy")
  const listed = await ReqWorkspace.list(tmp.path)
  expect(listed.map((item) => item.slug)).toEqual(["em-platform", "req", "staff-ml"])
})

test("resolve prefers the req containing cwd", async () => {
  await using tmp = await tmpdir()
  await ReqWorkspace.scaffold(tmp.path, "staff-ml")
  await ReqWorkspace.scaffold(tmp.path, "em-platform")
  const inside = path.join(tmp.path, ".moks/reqs/staff-ml/scores")
  expect(await ReqWorkspace.resolve(inside, tmp.path)).toBe(path.join(tmp.path, ".moks/reqs/staff-ml"))
  expect(await ReqWorkspace.resolve(tmp.path, tmp.path)).toBeUndefined()
})

test("resolve falls back to the only req", async () => {
  await using tmp = await tmpdir()
  await ReqWorkspace.scaffold(tmp.path, "staff-ml")
  expect(await ReqWorkspace.resolve(tmp.path, tmp.path)).toBe(path.join(tmp.path, ".moks/reqs/staff-ml"))
})
