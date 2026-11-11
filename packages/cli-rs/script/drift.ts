// Fails when a generated file or a committed parity fixture no longer matches the TypeScript it came from.
// Runs every generator in script/gen and every fixture-writing P-ORACLE in parity/oracle, then lists each file
// under packages/cli-rs whose content changed. Needs `bun install`.
//
// Left out by default, because their output is not a function of this checkout alone:
// - script/gen/grammars.ts downloads grammars from the network;
// - script/gen/time.ts depends on the ICU data of the running Bun;
// - the P-COMP (parity/component) and P-APP (parity/scenarios) recordings are slow and some are noisy.
// `--all` adds the two generators, `--recordings` adds the P-COMP and P-APP recordings.
//
// Run it on a clean tree. Files already dirty before the run count only if the run changes them again.
const root = new URL("..", import.meta.url).pathname
const parity = `${root}parity/`
const all = process.argv.includes("--all")
const recordings = process.argv.includes("--recordings")
const slow = new Set(["script/gen/grammars.ts", "script/gen/time.ts"])

const before = await snapshot()
const started = performance.now()

for (const script of Array.from(new Bun.Glob("script/gen/*.ts").scanSync({ cwd: root }))
  .sort()
  .filter((script) => all || !slow.has(script)))
  run(["bun", "run", script], root)

// The same oracle selection as parity/fixtures.ts: a first line that says "helper" writes no fixture.
const oracles = await Promise.all(
  Array.from(new Bun.Glob("oracle/*.ts").scanSync({ cwd: parity }))
    .sort()
    .map(async (script) => ({
      script,
      helper: /\bhelper\b/.test((await Bun.file(`${parity}${script}`).text()).split("\n", 1)[0]),
    })),
)
for (const oracle of oracles.filter((oracle) => !oracle.helper)) run(["bun", "run", oracle.script], parity)

if (recordings) {
  for (const script of Array.from(new Bun.Glob("component/*.tsx").scanSync({ cwd: parity })).sort())
    run(["bun", "run", script], parity)
  for (const scenario of Array.from(new Bun.Glob("scenarios/*/*.app.ts").scanSync({ cwd: parity }))
    .sort()
    .map((file) => file.slice("scenarios/".length, -".app.ts".length)))
    run(["bun", "test", "./app/scenarios.test.tsx"], parity, { PARITY_SCENARIO: scenario })
}

const after = await snapshot()
const changed = Array.from(new Set([...before.keys(), ...after.keys()]))
  .filter((file) => before.get(file) !== after.get(file))
  .sort()
const seconds = ((performance.now() - started) / 1000).toFixed(1)
if (changed.length === 0) {
  console.log(`drift: no generated file or fixture changed (${seconds} s)`)
  process.exit(0)
}
console.error(`drift: ${changed.length} file(s) no longer match TypeScript (${seconds} s):`)
for (const file of changed) console.error(`  ${file}`)
console.error("drift: commit the regenerated files, or fix the Rust side if the TypeScript change was intended.")
process.exit(1)

function run(command: string[], cwd: string, env: Record<string, string> = {}) {
  console.log(`drift: ${Object.entries(env).map(([key, value]) => `${key}=${value} `).join("")}${command.join(" ")}`)
  const proc = Bun.spawnSync(command, { cwd, env: { ...process.env, ...env }, stdout: "inherit", stderr: "inherit" })
  if (proc.exitCode !== 0) process.exit(proc.exitCode ?? 1)
}

// Maps every changed or untracked path under packages/cli-rs to a hash of its content. Porcelain paths are
// relative to the repository root.
async function snapshot() {
  const top = Bun.spawnSync(["git", "rev-parse", "--show-toplevel"], { cwd: root }).stdout.toString().trim()
  const proc = Bun.spawnSync(["git", "status", "--porcelain", "-z", "--untracked-files=all", "--", "."], { cwd: root })
  const files = proc.stdout
    .toString()
    .split("\0")
    .filter((entry) => entry.length > 3)
    .map((entry) => entry.slice(3))
  return new Map(
    await Promise.all(
      files.map(async (file) => {
        const handle = Bun.file(`${top}/${file}`)
        const hash = (await handle.exists()) ? Bun.hash(await handle.arrayBuffer()).toString() : "deleted"
        return [file, hash] as const
      }),
    ),
  )
}
