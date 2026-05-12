import { readdir, mkdir } from "node:fs/promises"
import { join } from "node:path"

const SRC = ".opencode"
const DST = ".octopus/config-preview"

const agents = (await readdir(join(SRC, "agents")))
  .filter(f => f.endsWith(".md"))

const skillDirs = (await readdir(join(SRC, "skills"), { withFileTypes: true }))
  .filter(e => e.isDirectory())
  .map(e => e.name)

for (const f of agents) {
  const content = await Bun.file(join(SRC, "agents", f)).text()
  await Bun.write(join(DST, "agents", f), content)
}

for (const dir of skillDirs) {
  await mkdir(join(DST, "skills", dir), { recursive: true })
  const content = await Bun.file(join(SRC, "skills", dir, "SKILL.md")).text()
  await Bun.write(join(DST, "skills", dir, "SKILL.md"), content)
}

console.log(`Synced ${agents.length} agents and ${skillDirs.length} skills.`)
