import { expect, test } from "bun:test"
import { $ } from "bun"
import path from "path"
import { CandidateCard } from "../../src/product/candidate-card"
import { HiringFixtures } from "../../src/product/fixtures"
import { ReqWorkspace } from "../../src/product/req-workspace"
import { tmpdir } from "../fixture/fixture"

test("slugify lowercases and hyphenates", () => {
  expect(ReqWorkspace.slugify("Senior Backend Engineer")).toBe("senior-backend-engineer")
  expect(ReqWorkspace.slugify("  staff-ml  ")).toBe("staff-ml")
  expect(ReqWorkspace.slugify("!!!")).toBe("")
})

test("scaffold creates company HIRING.md only in empty cwd", async () => {
  await using tmp = await tmpdir()
  const result = await ReqWorkspace.scaffold(tmp.path, "Senior Backend")
  expect(result.created).toEqual(["HIRING.md"])
  expect(result.relative).toBe(".")
  expect(result.title).toBe("Senior Backend")
  expect(await Bun.file(path.join(tmp.path, "HIRING.md")).text()).toBe(ReqWorkspace.COMPANY_STUB)
  expect(await Bun.file(path.join(tmp.path, "candidates/.gitkeep")).exists()).toBe(false)
  expect(await Bun.file(path.join(tmp.path, ".moks/reqs")).exists()).toBe(false)
  expect(await ReqWorkspace.isCompanyRoot(tmp.path)).toBe(true)
  expect(await ReqWorkspace.isPacket(tmp.path)).toBe(false)
  expect(await ReqWorkspace.listReqs(tmp.path)).toEqual([])
})

test("second call does not overwrite non-empty HIRING.md", async () => {
  await using tmp = await tmpdir()
  await ReqWorkspace.scaffold(tmp.path, "Senior Backend")
  const hiring = path.join(tmp.path, "HIRING.md")
  await Bun.write(hiring, "# Staff Engineer\n")
  const result = await ReqWorkspace.scaffold(tmp.path, "Other Title")
  expect(await Bun.file(hiring).text()).toBe("# Staff Engineer\n")
  expect(result.relative).toBe("other-title")
  expect(await Bun.file(path.join(tmp.path, "other-title", "HIRING.md")).exists()).toBe(true)
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

test("companyRoot is undefined without HIRING.md", async () => {
  await using tmp = await tmpdir({ git: true })
  expect(await ReqWorkspace.companyRoot(tmp.path)).toBeUndefined()
})

test("companyRoot returns a single-req packet", async () => {
  await using tmp = await tmpdir()
  await ReqWorkspace.scaffold(tmp.path, "Staff ML")
  expect(await ReqWorkspace.companyRoot(tmp.path)).toBe(tmp.path)
  expect(await ReqWorkspace.companyRoot(path.join(tmp.path, "candidates"))).toBe(tmp.path)
})

test("companyRoot returns company-only and lifts a nested req", async () => {
  await using tmp = await tmpdir()
  await Bun.write(path.join(tmp.path, "HIRING.md"), "# Co\n")
  const req = path.join(tmp.path, "senior-backend")
  await Bun.write(path.join(req, "HIRING.md"), "# SB\n")
  await Bun.write(path.join(req, "candidates", ".gitkeep"), "")
  expect(await ReqWorkspace.companyRoot(tmp.path)).toBe(tmp.path)
  expect(await ReqWorkspace.companyRoot(req)).toBe(tmp.path)
})

test("companyRoot does not walk past the company into a parent HIRING.md", async () => {
  await using tmp = await tmpdir()
  await Bun.write(path.join(tmp.path, "HIRING.md"), "# Software\n")
  const company = path.join(tmp.path, "acme")
  await Bun.write(path.join(company, "HIRING.md"), "# Acme\n")
  const req = path.join(company, "senior-backend")
  await Bun.write(path.join(req, "HIRING.md"), "# SB\n")
  await Bun.write(path.join(req, "candidates", ".gitkeep"), "")
  expect(await ReqWorkspace.companyRoot(req)).toBe(company)
  expect(await ReqWorkspace.companyRoot(company)).toBe(company)
})

test("git init happens when cwd is not a repo", async () => {
  await using tmp = await tmpdir()
  const result = await ReqWorkspace.scaffold(tmp.path, "Senior Backend")
  expect(result.git).toBe("created")
  expect((await $`git rev-parse --is-inside-work-tree`.cwd(tmp.path).text()).trim()).toBe("true")
  expect((await $`git log -1 --pretty=%s`.cwd(tmp.path).text()).trim()).toBe("moks: init")
})

test("isReqMaterial includes HIRING.md and candidates/*.md", () => {
  expect(ReqWorkspace.isReqMaterial("HIRING.md")).toBe(true)
  expect(ReqWorkspace.isReqMaterial("staff-ml/HIRING.md")).toBe(true)
  expect(ReqWorkspace.isReqMaterial("candidates/jordan-lee.md")).toBe(true)
  expect(ReqWorkspace.isReqMaterial("staff-ml/candidates/jordan-lee.md")).toBe(true)
  expect(ReqWorkspace.isReqMaterial("jd.md")).toBe(false)
  expect(ReqWorkspace.isReqMaterial("src/foo.ts")).toBe(false)
})

test("git init is skipped when already a repo", async () => {
  await using tmp = await tmpdir({ git: true })
  const before = (await $`git rev-list --count HEAD`.cwd(tmp.path).text()).trim()
  const result = await ReqWorkspace.scaffold(tmp.path, "Senior Backend")
  expect(result.git).toBe("existing")
  expect((await $`git rev-list --count HEAD`.cwd(tmp.path).text()).trim()).toBe(before)
})

test("isPacket requires HIRING.md and candidates/", async () => {
  await using tmp = await tmpdir()
  expect(await ReqWorkspace.isPacket(tmp.path)).toBe(false)
  expect(await ReqWorkspace.isCompanyRoot(tmp.path)).toBe(false)
  await Bun.write(path.join(tmp.path, "HIRING.md"), "# Co\n")
  expect(await ReqWorkspace.isPacket(tmp.path)).toBe(false)
  expect(await ReqWorkspace.isCompanyRoot(tmp.path)).toBe(true)
  await Bun.write(path.join(tmp.path, "candidates", ".gitkeep"), "")
  expect(await ReqWorkspace.isPacket(tmp.path)).toBe(true)
})

test("listReqs returns sorted child dirs with HIRING.md", async () => {
  await using tmp = await tmpdir()
  await Bun.write(path.join(tmp.path, "HIRING.md"), "# Co\n")
  await Bun.write(path.join(tmp.path, "staff-platform", "HIRING.md"), "# SP\n")
  await Bun.write(path.join(tmp.path, "senior-backend", "HIRING.md"), "# SB\n")
  await Bun.write(path.join(tmp.path, "notes", "keep.txt"), "x")
  expect(await ReqWorkspace.listReqs(tmp.path)).toEqual(["senior-backend", "staff-platform"])
})

test("workspaceEnv treats a packet cwd as company and req", async () => {
  const env = await ReqWorkspace.workspaceEnv(HiringFixtures.dir)
  expect(env).toEqual({
    company: HiringFixtures.dir,
    focused: "same as company",
    candidates: path.join(HiringFixtures.dir, "candidates"),
    hiring: "present",
  })
})

test("workspaceEnv treats company-only cwd as unfocused", async () => {
  await using tmp = await tmpdir()
  await Bun.write(path.join(tmp.path, "HIRING.md"), "# Co\n")
  expect(await ReqWorkspace.workspaceEnv(tmp.path)).toEqual({
    company: tmp.path,
    focused: "none",
    candidates: "none",
    hiring: "present",
  })
})

test("workspaceEnv treats a nested packet as focused req", async () => {
  await using tmp = await tmpdir()
  await Bun.write(path.join(tmp.path, "HIRING.md"), "# Co\n")
  const req = path.join(tmp.path, "senior-backend")
  await Bun.write(path.join(req, "HIRING.md"), "# SB\n")
  await Bun.write(path.join(req, "candidates", ".gitkeep"), "")
  expect(await ReqWorkspace.workspaceEnv(req)).toEqual({
    company: tmp.path,
    focused: req,
    candidates: path.join(req, "candidates"),
    hiring: "present",
  })
})

test("slateBlock lists fixture cards without body", async () => {
  const block = await ReqWorkspace.slateBlock(HiringFixtures.dir)
  expect(block).toBe(
    ["<slate>", "  jordan-lee  stage=sourced  path=candidates/jordan-lee.md", "</slate>"].join("\n"),
  )
  expect(block).not.toContain("score=")
  expect(block).not.toContain("Meridian Fleet")
})

test("slateBlock at company root lists req names not cards", async () => {
  await using tmp = await tmpdir()
  await Bun.write(path.join(tmp.path, "HIRING.md"), "# Co\n")
  await Bun.write(path.join(tmp.path, "staff-platform", "HIRING.md"), "# SP\n")
  await Bun.write(path.join(tmp.path, "senior-backend", "HIRING.md"), "# SB\n")
  await CandidateCard.write(path.join(tmp.path, "senior-backend"), {
    id: "jordan-lee",
    stage: "sourced",
    extra: {},
    body: "Meridian Fleet\n",
  })
  expect(await ReqWorkspace.slateBlock(tmp.path)).toBe(
    ["<reqs>", "  senior-backend", "  staff-platform", "</reqs>"].join("\n"),
  )
})

test("empty tmp then /init Senior Backend creates a req dir", async () => {
  await using tmp = await tmpdir()
  await ReqWorkspace.scaffold(tmp.path)
  const company = await Bun.file(path.join(tmp.path, "HIRING.md")).text()
  expect(company).toBe(ReqWorkspace.COMPANY_STUB)
  expect(await Bun.file(path.join(tmp.path, "candidates")).exists()).toBe(false)
  const result = await ReqWorkspace.scaffold(tmp.path, "Senior Backend")
  expect(result.relative).toBe("senior-backend")
  expect(result.created).toEqual(["senior-backend/HIRING.md", "senior-backend/candidates/.gitkeep"])
  expect(await Bun.file(path.join(tmp.path, "HIRING.md")).text()).toBe(company)
  expect(await Bun.file(path.join(tmp.path, "senior-backend", "HIRING.md")).text()).toBe(
    ReqWorkspace.stubFor("Senior Backend"),
  )
  expect(await Bun.file(path.join(tmp.path, "senior-backend", "candidates", ".gitkeep")).exists()).toBe(true)
  expect(await Bun.file(path.join(tmp.path, ".moks/reqs")).exists()).toBe(false)
  expect(await ReqWorkspace.listReqs(tmp.path)).toEqual(["senior-backend"])
  expect(await ReqWorkspace.isPacket(path.join(tmp.path, "senior-backend"))).toBe(true)
})

test("fixture layout /init does not nest a second req", async () => {
  await using tmp = await tmpdir()
  await Bun.write(path.join(tmp.path, "HIRING.md"), "# Req\n")
  await Bun.write(path.join(tmp.path, "candidates", ".gitkeep"), "")
  const result = await ReqWorkspace.scaffold(tmp.path, "Other")
  expect(result.relative).toBe(".")
  expect(await Bun.file(path.join(tmp.path, "other", "HIRING.md")).exists()).toBe(false)
  expect(await Bun.file(path.join(tmp.path, "HIRING.md")).text()).toBe("# Req\n")
  expect(await Bun.file(path.join(tmp.path, ".moks/reqs")).exists()).toBe(false)
})

test("company /init without a title does not invent a slug", async () => {
  await using tmp = await tmpdir()
  await ReqWorkspace.scaffold(tmp.path)
  const result = await ReqWorkspace.scaffold(tmp.path)
  expect(result.relative).toBe(".")
  expect(await ReqWorkspace.listReqs(tmp.path)).toEqual([])
})

test("focusedReq of a fixture is the fixture dir", async () => {
  expect(await ReqWorkspace.focusedReq(HiringFixtures.dir)).toBe(HiringFixtures.dir)
})

test("writeFocus persists a slug and focusedReq reads it back", async () => {
  await using tmp = await tmpdir()
  await Bun.write(path.join(tmp.path, "HIRING.md"), "# Co\n")
  const req = path.join(tmp.path, "staff-platform")
  await Bun.write(path.join(req, "HIRING.md"), "# SP\n")
  await Bun.write(path.join(req, "candidates", ".gitkeep"), "")
  await Bun.write(path.join(tmp.path, "senior-backend", "HIRING.md"), "# SB\n")
  await Bun.write(path.join(tmp.path, "senior-backend", "candidates", ".gitkeep"), "")
  expect(await ReqWorkspace.focusedReq(tmp.path)).toBeUndefined()
  await ReqWorkspace.writeFocus(tmp.path, "staff-platform")
  expect(await Bun.file(path.join(tmp.path, ReqWorkspace.FOCUS_FILE)).text()).toBe("staff-platform")
  expect(await Bun.file(path.join(tmp.path, ".moks/reqs")).exists()).toBe(false)
  expect(await ReqWorkspace.focusedReq(tmp.path)).toBe(req)
  expect(await ReqWorkspace.readFocus(tmp.path)).toBe("staff-platform")
})

test("readFocus ignores empty slugs and path traversal", async () => {
  await using tmp = await tmpdir()
  await Bun.write(path.join(tmp.path, "HIRING.md"), "# Co\n")
  await Bun.write(path.join(tmp.path, ".moks/focus"), "   \n")
  expect(await ReqWorkspace.readFocus(tmp.path)).toBeUndefined()
  await Bun.write(path.join(tmp.path, ".moks/focus"), "../staff-platform\n")
  expect(await ReqWorkspace.readFocus(tmp.path)).toBeUndefined()
  await Bun.write(path.join(tmp.path, ".moks/focus"), "/tmp/staff-platform\n")
  expect(await ReqWorkspace.readFocus(tmp.path)).toBeUndefined()
})

test("slateBlock at a focused company lists that packet only", async () => {
  await using tmp = await tmpdir()
  await Bun.write(path.join(tmp.path, "HIRING.md"), "# Co\n")
  await Bun.write(path.join(tmp.path, "staff-platform", "HIRING.md"), "# SP\n")
  await Bun.write(path.join(tmp.path, "senior-backend", "HIRING.md"), "# SB\n")
  await CandidateCard.write(path.join(tmp.path, "staff-platform"), {
    id: "alex-kim",
    stage: "sourced",
    extra: {},
    body: "Harbor Logistics\n",
  })
  await CandidateCard.write(path.join(tmp.path, "senior-backend"), {
    id: "jordan-lee",
    stage: "sourced",
    extra: {},
    body: "Meridian Fleet\n",
  })
  await ReqWorkspace.writeFocus(tmp.path, "staff-platform")
  expect(await ReqWorkspace.slateBlock(tmp.path)).toBe(
    ["<slate>", "  alex-kim  stage=sourced  path=candidates/alex-kim.md", "</slate>"].join("\n"),
  )
  expect(await ReqWorkspace.workspaceEnv(tmp.path)).toEqual({
    company: tmp.path,
    focused: path.join(tmp.path, "staff-platform"),
    candidates: path.join(tmp.path, "staff-platform", "candidates"),
    hiring: "present",
  })
  expect(await Bun.file(path.join(tmp.path, ".moks/focus")).exists()).toBe(true)
  expect(await Bun.file(path.join(tmp.path, ".moks/reqs")).exists()).toBe(false)
})

test("slateBlock caps cards at 20 and omits body", async () => {
  await using tmp = await tmpdir()
  await Bun.write(path.join(tmp.path, "HIRING.md"), "# Req\n")
  for (const n of Array.from({ length: 21 }, (_, i) => i + 1)) {
    const id = `c${String(n).padStart(2, "0")}`
    await CandidateCard.write(tmp.path, { id, stage: "sourced", extra: {}, body: "Meridian Fleet\n" })
  }
  const block = await ReqWorkspace.slateBlock(tmp.path)
  expect(block).toContain("c01")
  expect(block).toContain("c20")
  expect(block).not.toContain("c21")
  expect(block).not.toContain("Meridian Fleet")
  expect(block?.split("\n").filter((line) => line.startsWith("  ")).length).toBe(20)
})
