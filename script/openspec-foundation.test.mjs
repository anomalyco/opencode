import assert from "node:assert/strict"
import { readdir, readFile } from "node:fs/promises"
import path from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const workflows = [
  ["propose", "openspec-propose"],
  ["explore", "openspec-explore"],
  ["new", "openspec-new-change"],
  ["continue", "openspec-continue-change"],
  ["apply", "openspec-apply-change"],
  ["update", "openspec-update-change"],
  ["ff", "openspec-ff-change"],
  ["sync", "openspec-sync-specs"],
  ["archive", "openspec-archive-change"],
  ["bulk-archive", "openspec-bulk-archive-change"],
  ["verify", "openspec-verify-change"],
  ["onboard", "openspec-onboard"],
]
const expectedSkills = workflows.map((workflow) => workflow[1]).sort()
const expectedCommands = workflows.map((workflow) => `opsx-${workflow[0]}.md`).sort()

test("Codex exposes all 12 OpenSpec workflows", async () => {
  assert.deepEqual(await skillDirectories(".codex/skills"), expectedSkills)
})

test("OpenCode exposes all 12 OpenSpec workflows", async () => {
  assert.deepEqual(await skillDirectories(".opencode/skills"), expectedSkills)
})

test("OpenCode exposes commands for all 12 OpenSpec workflows", async () => {
  assert.deepEqual(
    (await readdir(path.join(root, ".opencode/commands")))
      .filter((entry) => entry.startsWith("opsx-") && entry.endsWith(".md"))
      .sort(),
    expectedCommands,
  )
})

test("every generated workflow reference resolves to a generated target", async () => {
  const files = [
    ...(await generatedFiles(".codex/skills", "SKILL.md")),
    ...(await generatedFiles(".opencode/skills", "SKILL.md")),
    ...(await generatedFiles(".opencode/commands", ".md")),
  ]
  const contents = await Promise.all(files.map((file) => readFile(file, "utf8")))
  const skillReferences = new Set(
    contents.flatMap((content) =>
      [...content.matchAll(/\bopenspec-[a-z][a-z-]*\b/g)]
        .map((match) => match[0])
        .filter((name) => name !== "openspec-cn"),
    ),
  )
  const commandReferences = new Set(
    contents.flatMap((content) =>
      [...content.matchAll(/\/opsx(?::|-)([a-z][a-z-]*)\b/g)].map(
        (match) => `opsx-${match[1]}.md`,
      ),
    ),
  )

  assert.deepEqual(
    [...skillReferences].filter((name) => !expectedSkills.includes(name)),
    [],
    "generated files reference unknown OpenSpec skills",
  )
  assert.deepEqual(
    [...commandReferences].filter((name) => !expectedCommands.includes(name)),
    [],
    "generated files reference unknown OPSX commands",
  )
  assert.deepEqual(
    [...skillReferences].filter(
      (name) => !expectedSkills.includes(name) || !files.some((file) => file.includes(`${name}${path.sep}`)),
    ),
    [],
    "generated skill references must exist on disk",
  )
  assert.deepEqual(
    [...commandReferences].filter(
      (name) => !files.some((file) => file.endsWith(`${path.sep}${name}`)),
    ),
    [],
    "generated command references must exist on disk",
  )
})

async function skillDirectories(directory) {
  return (await readdir(path.join(root, directory), { withFileTypes: true }))
    .filter((entry) => entry.isDirectory() && entry.name.startsWith("openspec-"))
    .map((entry) => entry.name)
    .sort()
}

async function generatedFiles(directory, suffix) {
  return (await readdir(path.join(root, directory), { withFileTypes: true })).flatMap(
    (entry) => {
      if (entry.isDirectory() && entry.name.startsWith("openspec-"))
        return path.join(root, directory, entry.name, suffix)
      if (entry.isFile() && entry.name.startsWith("opsx-") && entry.name.endsWith(suffix))
        return path.join(root, directory, entry.name)
      return []
    },
  )
}
