#!/usr/bin/env bun

import { $ } from "bun"
import { cp, mkdtemp, readdir, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import source from "../skills-source.json"

if (Bun.argv.includes("--help")) {
  console.log("Usage: bun run sync:skills [branch, tag, or commit]\nDefaults to main. Syncs all official Figma skills.")
  process.exit(0)
}

const root = fileURLToPath(new URL("..", import.meta.url))
const ref = Bun.argv[2] ?? "main"
const directory = await mkdtemp(path.join(tmpdir(), "opencode-figma-sync-"))
const checkout = path.join(directory, "upstream")

try {
  await $`git clone --quiet --depth 1 --no-checkout ${source.repository} ${checkout}`
  await $`git -C ${checkout} fetch --quiet --depth 1 origin ${ref}`
  await $`git -C ${checkout} checkout --quiet --detach FETCH_HEAD`
  const revision = (await $`git -C ${checkout} rev-parse HEAD`.text()).trim()
  const skills = (
    await Promise.all(
      (await readdir(path.join(checkout, "skills"), { withFileTypes: true })).map(async (entry) => {
        if (!entry.isDirectory()) return []
        if (!(await Bun.file(path.join(checkout, "skills", entry.name, "SKILL.md")).exists())) return []
        return [entry.name]
      }),
    )
  )
    .flat()
    .toSorted()

  // Download every skill directory before replacing any checked-in files.
  await Promise.all(
    skills.map((name) =>
      cp(path.join(checkout, "skills", name), path.join(directory, "skills", name), { recursive: true }),
    ),
  )
  await Promise.all(
    skills.map(async (name) => {
      await rm(path.join(root, "skills", name), { recursive: true, force: true })
      await cp(path.join(directory, "skills", name), path.join(root, "skills", name), { recursive: true })
    }),
  )
  await Promise.all(
    source.skills.flatMap((name) =>
      skills.includes(name) ? [] : [rm(path.join(root, "skills", name), { recursive: true, force: true })],
    ),
  )
  await Bun.write(
    path.join(root, "skills-source.json"),
    `${JSON.stringify({ ...source, revision, skills }, null, 2)}\n`,
  )
  console.log(`Synced ${skills.length} Figma skills at ${revision}. Review the source changes before committing.`)
} finally {
  await rm(directory, { recursive: true, force: true })
}
