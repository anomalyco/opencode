import path from "node:path"

const args = Bun.argv.slice(2)
const checks = ["i18n-check-keys.ts", "i18n-check-pages.ts", "i18n-check-links.ts", "i18n-check-ui-strings.ts"]

for (const check of checks) {
  const file = path.join(import.meta.dir, check)
  const proc = Bun.spawnSync(["bun", file, ...args], {
    stdout: "inherit",
    stderr: "inherit",
  })
  if (proc.exitCode === 0) {
    continue
  }
  process.exit(proc.exitCode)
}

console.log("All i18n checks passed.")
