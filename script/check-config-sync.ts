import { readdir } from "node:fs/promises"
import { join } from "node:path"

const OPTS = { directory: ".opencode" }
const DST = ".octopus/config-preview"

const agents = (await readdir(join(OPTS.directory, "agents")))
  .filter(f => f.endsWith(".md"))
  .sort()

const skillDirs = (await readdir(join(OPTS.directory, "skills"), { withFileTypes: true }))
  .filter(e => e.isDirectory())
  .map(e => e.name)
  .sort()

const mismatches: string[] = []

for (const f of agents) {
  const src = await Bun.file(join(OPTS.directory, "agents", f)).text()
  const dstFile = Bun.file(join(DST, "agents", f))
  const exists = await dstFile.exists()
  if (!exists) { mismatches.push(`agents/${f} (missing from config-preview)`); continue }
  const dst = await dstFile.text()
  if (src !== dst) mismatches.push(`agents/${f}`)
}

for (const dir of skillDirs) {
  const src = await Bun.file(join(OPTS.directory, "skills", dir, "SKILL.md")).text()
  const dstFile = Bun.file(join(DST, "skills", dir, "SKILL.md"))
  const exists = await dstFile.exists()
  if (!exists) { mismatches.push(`skills/${dir}/SKILL.md (missing from config-preview)`); continue }
  const dst = await dstFile.text()
  if (src !== dst) mismatches.push(`skills/${dir}/SKILL.md`)
}

if (mismatches.length > 0) {
  console.log("Unsynchronized files:")
  for (const m of mismatches) console.log(`  ${m}`)
  console.log("\nRun: bun run script/sync-config.ts")
  process.exit(1)
}

console.log("All config files in sync.")
