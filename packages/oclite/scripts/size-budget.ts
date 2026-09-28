#!/usr/bin/env bun
// Size budget (SPEC §7): src/**/*.ts ≤ 45 files (forked and .d.ts included) and ≤ 7000 lines excluding src/forked/.
// Usage: bun run scripts/size-budget.ts [dir]   (dir defaults to packages/oclite/src)
import path from "path"

const MAX_FILES = 45
const MAX_LINES = 7000

const dir = path.resolve(process.argv[2] ?? path.join(import.meta.dir, "..", "src"))
const files = (await Array.fromAsync(new Bun.Glob("**/*.ts").scan({ cwd: dir }))).sort()
const counted = await Promise.all(
  files.map(async (file) => ({
    file,
    lines: (await Bun.file(path.join(dir, file)).text()).replace(/\n$/, "").split("\n").length,
    forked: file.replaceAll("\\", "/").startsWith("forked/"),
  })),
)
const own = counted.filter((item) => !item.forked)
const forked = counted.filter((item) => item.forked)
const lines = own.reduce((sum, item) => sum + item.lines, 0)
const forkedLines = forked.reduce((sum, item) => sum + item.lines, 0)

counted
  .toSorted((a, b) => b.lines - a.lines)
  .forEach((item) => console.log(`${String(item.lines).padStart(6)}  ${item.file}${item.forked ? "  (forked)" : ""}`))
console.log(`files: ${files.length} / ${MAX_FILES}`)
console.log(`lines: ${lines} / ${MAX_LINES} (excluding forked)`)
console.log(`forked: ${forked.length} files, ${forkedLines} lines (reported, not counted)`)

const breaches = [
  files.length > MAX_FILES && `file count ${files.length} > ${MAX_FILES}`,
  lines > MAX_LINES && `line count ${lines} > ${MAX_LINES}`,
].filter((item) => typeof item === "string")
if (breaches.length) {
  console.error(`size budget exceeded: ${breaches.join("; ")}`)
  process.exit(1)
}
console.log("size budget ok")
