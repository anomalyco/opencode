import { expect, test } from "bun:test"
import { HotReload } from "../../src/project/hotreload"

const root = "/tmp/openwork-hotreload"

test("matches project config files", () => {
  expect(HotReload.classify(root, `${root}/opencode.json`)).toBe("opencode.json")
  expect(HotReload.classify(root, `${root}/opencode.jsonc`)).toBe("opencode.jsonc")
  expect(HotReload.classify(root, `${root}/AGENTS.md`)).toBe("AGENTS.md")
})

test("matches opencode directories", () => {
  expect(HotReload.classify(root, `${root}/.opencode/skills/new-skill/SKILL.md`)).toBe(
    ".opencode/skills/new-skill/SKILL.md",
  )
  expect(HotReload.classify(root, `${root}/.opencode/commands/fix.md`)).toBe(
    ".opencode/commands/fix.md",
  )
  expect(HotReload.classify(root, `${root}/.opencode/plugins/example.ts`)).toBe(
    ".opencode/plugins/example.ts",
  )
})

test("ignores metadata, temp files, and unrelated files", () => {
  expect(HotReload.classify(root, `${root}/README.md`)).toBeUndefined()
  expect(HotReload.classify(root, `${root}/.opencode/openwork/openwork.json`)).toBeUndefined()
  expect(HotReload.classify(root, `${root}/.opencode/skills/new-skill/SKILL.md.swp`)).toBeUndefined()
  expect(HotReload.classify(root, `${root}/.git/HEAD`)).toBeUndefined()
  expect(HotReload.classify(root, `/tmp/other/opencode.json`)).toBeUndefined()
})

test("matches darwin /private path aliases", () => {
  const privateRoot = "/private/tmp/openwork-hotreload"
  expect(HotReload.classify(privateRoot, "/tmp/openwork-hotreload/.opencode/commands/fix.md")).toBe(
    ".opencode/commands/fix.md",
  )
})
