import { expect, test } from "bun:test"
import { $ } from "bun"
import path from "path"
import { ReqWorkspace } from "../../src/product/req-workspace"
import { tmpdir } from "../fixture/fixture"

test("slugify lowercases and hyphenates", () => {
  expect(ReqWorkspace.slugify("Senior Backend Engineer")).toBe("senior-backend-engineer")
  expect(ReqWorkspace.slugify("  staff-ml  ")).toBe("staff-ml")
  expect(ReqWorkspace.slugify("!!!")).toBe("")
})

test("scaffold creates HIRING.md and candidates/.gitkeep in cwd", async () => {
  await using tmp = await tmpdir()
  const result = await ReqWorkspace.scaffold(tmp.path, "Senior Backend")
  expect(result.created).toEqual(["HIRING.md", "candidates/.gitkeep"])
  expect(result.relative).toBe(".")
  expect(result.title).toBe("Senior Backend")
  expect(await Bun.file(path.join(tmp.path, "HIRING.md")).text()).toBe(ReqWorkspace.stubFor("Senior Backend"))
  expect(await Bun.file(path.join(tmp.path, "candidates/.gitkeep")).exists()).toBe(true)
  expect(await Bun.file(path.join(tmp.path, ".moks/reqs")).exists()).toBe(false)
})

test("second call does not overwrite non-empty HIRING.md", async () => {
  await using tmp = await tmpdir()
  await ReqWorkspace.scaffold(tmp.path, "Senior Backend")
  const hiring = path.join(tmp.path, "HIRING.md")
  await Bun.write(hiring, "# Staff Engineer\n")
  const result = await ReqWorkspace.scaffold(tmp.path, "Other Title")
  expect(result.skipped).toContain("HIRING.md")
  expect(await Bun.file(hiring).text()).toBe("# Staff Engineer\n")
})

test("does not add .moks/ to .gitignore", async () => {
  await using tmp = await tmpdir()
  const gi = path.join(tmp.path, ".gitignore")
  await Bun.write(gi, "node_modules/\n")
  await ReqWorkspace.scaffold(tmp.path, "Senior Backend")
  expect(await Bun.file(gi).text()).toBe("node_modules/\n")
  expect(await Bun.file(path.join(tmp.path, ".gitignore")).text()).not.toContain(".moks/")
})

test("does not create a gitignore when none exists", async () => {
  await using tmp = await tmpdir()
  await ReqWorkspace.scaffold(tmp.path, "Senior Backend")
  expect(await Bun.file(path.join(tmp.path, ".gitignore")).exists()).toBe(false)
})

test("resolve walks up to HIRING.md", async () => {
  await using tmp = await tmpdir()
  await ReqWorkspace.scaffold(tmp.path, "Staff ML")
  const nested = path.join(tmp.path, "candidates", "nested")
  await Bun.write(path.join(nested, "keep.txt"), "x")
  expect(await ReqWorkspace.resolve(nested, tmp.path)).toBe(tmp.path)
  expect(await ReqWorkspace.resolve(tmp.path, tmp.path)).toBe(tmp.path)
})

test("resolve returns undefined when no HIRING.md is found", async () => {
  await using tmp = await tmpdir()
  expect(await ReqWorkspace.resolve(tmp.path, tmp.path)).toBeUndefined()
})

test("git init happens when cwd is not a repo", async () => {
  await using tmp = await tmpdir()
  const result = await ReqWorkspace.scaffold(tmp.path, "Senior Backend")
  expect(result.git).toBe("created")
  expect((await $`git rev-parse --is-inside-work-tree`.cwd(tmp.path).text()).trim()).toBe("true")
  expect((await $`git log -1 --pretty=%s`.cwd(tmp.path).text()).trim()).toBe("moks: init")
})

test("git init is skipped when already a repo", async () => {
  await using tmp = await tmpdir({ git: true })
  const before = (await $`git rev-list --count HEAD`.cwd(tmp.path).text()).trim()
  const result = await ReqWorkspace.scaffold(tmp.path, "Senior Backend")
  expect(result.git).toBe("existing")
  expect((await $`git rev-list --count HEAD`.cwd(tmp.path).text()).trim()).toBe(before)
})
