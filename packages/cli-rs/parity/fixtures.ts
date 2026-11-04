// Regenerates the committed parity fixtures after a TypeScript change: runs every P-ORACLE script in
// parity/oracle and every P-APP scenario in parity/app, in name order. Each writes its own parity/fixtures/<step>/.
const parity = new URL(".", import.meta.url).pathname
const oracles = Array.from(new Bun.Glob("oracle/*.ts").scanSync({ cwd: parity })).sort()
const scenarios = Array.from(new Bun.Glob("app/*.test.tsx").scanSync({ cwd: parity })).sort()

for (const script of oracles) run(["bun", "run", script])
// Runs from parity/ so bun test picks up the TUI preloads in parity/bunfig.toml (H.2).
if (scenarios.length > 0) run(["bun", "test", ...scenarios.map((file) => `./${file}`)])
if (oracles.length + scenarios.length === 0) console.log("fixtures: no oracle scripts or app scenarios yet")

function run(command: string[]) {
  console.log(`fixtures: ${command.join(" ")}`)
  const proc = Bun.spawnSync(command, { cwd: parity, stdout: "inherit", stderr: "inherit" })
  if (proc.exitCode !== 0) process.exit(proc.exitCode ?? 1)
}
