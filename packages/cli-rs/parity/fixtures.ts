// Regenerates the committed parity fixtures after a TypeScript change: runs every P-ORACLE script in
// parity/oracle, every P-COMP script in parity/component, and every P-APP scenario in parity/app, in name
// order. Each writes its own parity/fixtures/<step>/.
//
// Oracle scripts whose first line names them a "helper" (E.2-history.ts, F.4-local.ts, and others) write no
// fixture: Rust tests run them with arguments, so they are skipped here.
const parity = new URL(".", import.meta.url).pathname
const scripts = Array.from(new Bun.Glob("oracle/*.ts").scanSync({ cwd: parity })).sort()
const helpers = await Promise.all(
  scripts.map(async (script) => /\bhelper\b/.test((await Bun.file(`${parity}${script}`).text()).split("\n", 1)[0])),
)
const oracles = scripts.filter((_, index) => !helpers[index])
const components = Array.from(new Bun.Glob("component/*.tsx").scanSync({ cwd: parity })).sort()
const scenarios = Array.from(new Bun.Glob("scenarios/*/*.app.ts").scanSync({ cwd: parity }))
  .sort()
  .map((file) => file.slice("scenarios/".length, -".app.ts".length))

for (const script of oracles) run(["bun", "run", script])
// Component scripts and scenarios run from parity/ so bun picks up the TUI preloads in parity/bunfig.toml.
for (const script of components) run(["bun", "run", script])
// One process per scenario: the TUI keeps module state, such as the prompt drafts of
// component/prompt/draft-stash.ts, that would carry one scenario's input into the next.
for (const scenario of scenarios)
  run(["bun", "test", "./app/scenarios.test.tsx"], { PARITY_SCENARIO: scenario })
if (oracles.length + components.length + scenarios.length === 0)
  console.log("fixtures: no oracle scripts, component scripts, or app scenarios yet")

function run(command: string[], env: Record<string, string> = {}) {
  console.log(`fixtures: ${Object.entries(env).map(([key, value]) => `${key}=${value} `).join("")}${command.join(" ")}`)
  const proc = Bun.spawnSync(command, {
    cwd: parity,
    env: { ...process.env, ...env },
    stdout: "inherit",
    stderr: "inherit",
  })
  if (proc.exitCode !== 0) process.exit(proc.exitCode ?? 1)
}
