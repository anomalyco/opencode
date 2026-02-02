#!/usr/bin/env bun
// Run Ink files without SolidJS plugins
const file = process.argv[2]
if (!file) {
  console.error("Usage: bun --no-plugins src/cli/ink/run.ts <file>")
  process.exit(1)
}
const absolute = Bun.resolveSync(file, process.cwd())
console.error("Loading:", absolute)
await import(absolute)
