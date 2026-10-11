#!/usr/bin/env bun

import { generateSkillReferences } from "../src/skills/references"

const root = import.meta.dir + "/.."

for (const reference of await generateSkillReferences(root)) {
  await Bun.write(`${root}/${reference.path}`, reference.content)
  console.log(`Wrote ${reference.path}`)
}
