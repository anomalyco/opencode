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
const handwrittenFiles = [
  "AGENTS.md",
  "openspec/config.yaml",
  "docs/superpowers/specs/2026-07-23-openspec-superpowers-foundation-design.md",
  "docs/superpowers/plans/2026-07-23-openspec-superpowers-foundation.md",
  "docs/workflows/openspec-superpowers.md",
  "docs/workflows/execution-prompts.md",
]

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

test("generated skills have matching names, version metadata, and bodies", async () => {
  await Promise.all(
    [".codex/skills", ".opencode/skills"].flatMap((directory) =>
      expectedSkills.map(async (name) => {
        const content = await readFile(path.join(root, directory, name, "SKILL.md"), "utf8")
        const document = markdownDocument(content)

        assert.match(document.frontmatter, new RegExp(`^name: ${name}$`, "m"))
        assert.match(document.frontmatter, /^  generatedBy: "1\.6\.0"$/m)
        assert.notEqual(document.body.trim(), "", `${directory}/${name} must have a body`)
      }),
    ),
  )
})

test("generated OpenCode commands have valid frontmatter, bodies, and actual entries", async () => {
  await Promise.all(
    workflows.map(async (workflow) => {
      const entry = `/opsx-${workflow[0]}`
      const content = await readFile(
        path.join(root, ".opencode/commands", `opsx-${workflow[0]}.md`),
        "utf8",
      )
      const document = markdownDocument(content)
      const references = [...document.body.matchAll(/\/opsx(?::|-)([a-z][a-z-]*)\b/g)]

      assert.match(document.frontmatter, /^description: \S.+$/m)
      assert.notEqual(document.body.trim(), "", `${entry} must have a body`)
      assert.deepEqual(
        references.filter((reference) => reference[0].startsWith("/opsx:")),
        [],
        `${entry} must use OpenCode's hyphen command syntax`,
      )
      assert.deepEqual(
        references
          .map((reference) => `opsx-${reference[1]}.md`)
          .filter((name) => !expectedCommands.includes(name)),
        [],
        `${entry} references unknown OpenCode commands`,
      )
      assert.ok(
        document.body.includes(entry) || document.body.includes("**输入**：无需输入"),
        `${entry} must identify its actual entry unless it takes no input`,
      )
    }),
  )
})

test("handwritten host guidance uses actual OpenCode command syntax", async () => {
  const contents = await Promise.all(
    handwrittenFiles.map(async (file) => [file, await readFile(path.join(root, file), "utf8")]),
  )
  const invalid = contents.flatMap(([file, content]) =>
    [...content.matchAll(/\/opsx:([a-z][a-z-]*)\b/g)].map(
      (match) => `${file}: ${match[0]}`,
    ),
  )
  const combined = contents.map((entry) => entry[1]).join("\n")

  assert.deepEqual(
    invalid,
    [],
    "OpenCode host entries must use /opsx-<name>, not upstream logical colon notation",
  )
  assert.match(combined, /\/opsx-verify\b/)
  assert.match(combined, /\/opsx:\*/)
  assert.match(combined, /逻辑记法/)
})

test("every generated workflow reference resolves to a generated target", async () => {
  const skillFiles = [
    ...(await generatedFiles(".codex/skills", "SKILL.md")),
    ...(await generatedFiles(".opencode/skills", "SKILL.md")),
  ]
  const commandFiles = [
    ...(await generatedFiles(".opencode/commands", ".md")),
  ]
  const skillContents = await Promise.all(skillFiles.map((file) => readFile(file, "utf8")))
  const commandContents = await Promise.all(
    commandFiles.map((file) => readFile(file, "utf8")),
  )
  const skillReferences = new Set(
    skillContents.flatMap((content) =>
      [...content.matchAll(/\bopenspec-[a-z][a-z-]*\b/g)]
        .map((match) => match[0])
        .filter((name) => name !== "openspec-cn"),
    ),
  )
  const logicalCommandReferences = new Set(
    skillContents.flatMap((content) =>
      [...content.matchAll(/\/opsx:([a-z][a-z-]*)\b/g)].map(
        (match) => `opsx-${match[1]}.md`,
      ),
    ),
  )
  const actualCommandReferences = new Set(
    commandContents.flatMap((content) =>
      [...content.matchAll(/\/opsx-([a-z][a-z-]*)\b/g)].map(
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
    [...logicalCommandReferences].filter((name) => !expectedCommands.includes(name)),
    [],
    "generated skills reference unknown logical OPSX commands",
  )
  assert.deepEqual(
    [...actualCommandReferences].filter((name) => !expectedCommands.includes(name)),
    [],
    "generated commands reference unknown actual OpenCode commands",
  )
  assert.deepEqual(
    [...skillReferences].filter(
      (name) =>
        !expectedSkills.includes(name) ||
        !skillFiles.some((file) => file.includes(`${name}${path.sep}`)),
    ),
    [],
    "generated skill references must exist on disk",
  )
  assert.deepEqual(
    [...logicalCommandReferences, ...actualCommandReferences].filter(
      (name) => !commandFiles.some((file) => file.endsWith(`${path.sep}${name}`)),
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

function markdownDocument(content) {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]+)$/)

  assert.ok(match, "generated Markdown must contain frontmatter and a body")
  return {
    frontmatter: match[1],
    body: match[2],
  }
}
