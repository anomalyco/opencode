// P-WIRE (plan 7.1): runs each ACP subprocess suite of `packages/cli/test/acp` against the TS agent and
// against `opencode-rs acp`, records every agent's JSON-RPC traffic, and compares the transcripts.
//
//   bun run parity/acp/run.ts [suite ...]
//
// A suite is a `*.subprocess.test.ts` file name, with or without the suffix; without names it runs them
// all. Both sides run through `record.sh` (OPENCODE_ACP_TEST_BIN), which records `in.ndjson` (client to
// agent) and `out.ndjson` (agent to client) per agent process under
// `$TMPDIR/opencode-parity/acp/<suite>-<side>/`. The n-th process of one side is compared with the n-th
// of the other, each direction on its own, so the interleaving of the two directions does not matter.
// Lines are compared byte for byte, key order included, after the plan 7.5 normalizers (`parity/cli`)
// and with the fixture's temporary root replaced.

import { Glob } from "bun"
import { mkdir, readdir, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { buildRust, normalize } from "../cli/client"

type Side = "ts" | "rs"
type Process = { in: string[]; out: string[] }

const rs = path.resolve(import.meta.dir, "../..")
const cli = path.resolve(rs, "../cli")
const sides: Side[] = ["ts", "rs"]

const filter = Bun.argv.slice(2).map((name) => path.basename(name).replace(/(\.subprocess\.test\.ts)?$/, ""))
const suites = [...new Glob("test/acp/*.subprocess.test.ts").scanSync({ cwd: cli })]
  .map((file) => path.basename(file, ".subprocess.test.ts"))
  .filter((suite) => filter.length === 0 || filter.includes(suite))
  .toSorted()
const unknown = filter.filter((name) => !suites.includes(name))
if (unknown.length) throw new Error(`no ACP subprocess suite named ${unknown.join(", ")}`)

await buildRust(["rs"])

const failed = await suites.reduce(async (previous, suite) => {
  const failures = await previous
  const runs = await Promise.all(sides.map((side) => runSuite(suite, side)))
  const differences = compare(runs[0].processes, runs[1].processes)
  console.log(
    [
      `${differences.length || runs.some((run) => !run.ok) ? "FAIL" : "ok  "} ${suite}`,
      ...runs.map((run, index) => `  ${sides[index]}: ${run.summary}, ${run.processes.length} processes`),
      ...runs.flatMap((run, index) => (run.ok ? [] : [`  ${sides[index]} output:`, indent(run.output)])),
      ...(differences.length
        ? differences
        : [
            `  transcripts identical after normalization (${runs[0].processes.reduce((sum, agent) => sum + agent.in.length + agent.out.length, 0)} messages)`,
          ]),
    ].join("\n"),
  )
  return failures + (differences.length || runs.some((run) => !run.ok) ? 1 : 0)
}, Promise.resolve(0))
process.exit(failed ? 1 : 0)

async function runSuite(suite: string, side: Side) {
  const dir = path.join(tmpdir(), "opencode-parity/acp", `${suite}-${side}`)
  await rm(dir, { recursive: true, force: true })
  await mkdir(dir, { recursive: true })
  const proc = Bun.spawn(["bun", "test", `test/acp/${suite}.subprocess.test.ts`], {
    cwd: cli,
    env: {
      ...process.env,
      OPENCODE_ACP_TEST_BIN: path.join(import.meta.dir, "record.sh"),
      ACP_RECORD_DIR: dir,
      ACP_RECORD_TARGET:
        side === "ts"
          ? `${process.execPath} run src/index.ts`
          : (process.env.OPENCODE_RS_BIN ?? path.join(rs, "target/debug/opencode-rs")),
      ...(side === "rs" ? { OPENCODE_TS_BIN: path.join(import.meta.dir, "opencode-ts") } : {}),
    },
    stdout: "pipe",
    stderr: "pipe",
    timeout: 300_000,
    killSignal: "SIGKILL",
  })
  const [stdout, stderr, exit] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ])
  const output = `${stdout}${stderr}`
  const count = (word: string) => Number(output.match(new RegExp(`^\\s*(\\d+) ${word}$`, "m"))?.[1] ?? 0)
  return {
    ok: exit === 0,
    summary: `${count("pass")} pass, ${count("fail")} fail${exit === 0 ? "" : ` (exit ${exit})`}`,
    output,
    processes: await transcripts(dir),
  }
}

// Each copy in `record.sh` writes its `.done` marker once it has exited, which is after the agent and
// everything holding its stdout have closed it, and after the suite closed the agent's stdin.
async function transcripts(dir: string) {
  const names = (await readdir(dir)).toSorted((a, b) => Number(a.split(".")[0]) - Number(b.split(".")[0]))
  const deadline = Date.now() + 30_000
  const done = (name: string) =>
    Promise.all(["in.done", "out.done"].map((file) => Bun.file(path.join(dir, name, file)).exists())).then((found) =>
      found.every(Boolean),
    )
  while (!(await Promise.all(names.map(done))).every(Boolean)) {
    if (Date.now() > deadline) throw new Error(`the recorders under ${dir} did not finish`)
    await Bun.sleep(20)
  }
  return Promise.all(
    names.map(async (name) => ({
      in: messages(await Bun.file(path.join(dir, name, "in.ndjson")).text()),
      out: messages(await Bun.file(path.join(dir, name, "out.ndjson")).text()),
    })),
  )
}

function messages(text: string) {
  return text
    .split("\n")
    .filter((line) => line.trim())
    .map((line) =>
      normalize(line.replaceAll(/(?:\/[\w.-]+)*\/opencode-cli-acp-[A-Za-z0-9]+/g, "<root>"), { root: "<root>" }),
    )
}

function compare(ts: Process[], rs: Process[]) {
  const count = ts.length === rs.length ? [] : [`  process count differs: ts ${ts.length}, rs ${rs.length}`]
  return [
    ...count,
    ...ts.slice(0, rs.length).flatMap((agent, index) =>
      (["in", "out"] as const).flatMap((direction) => {
        const a = agent[direction]
        const b = rs[index][direction]
        const lines = Array.from({ length: Math.max(a.length, b.length) }, (_, line) => line).filter(
          (line) => a[line] !== b[line],
        )
        if (lines.length === 0) return []
        return [
          `  process ${index} ${direction}: ${lines.length} of ${Math.max(a.length, b.length)} messages differ (ts ${a.length}, rs ${b.length})`,
          ...lines
            .slice(0, 5)
            .flatMap((line) => [`    #${line} ts ${a[line] ?? "(none)"}`, `    #${line} rs ${b[line] ?? "(none)"}`]),
        ]
      }),
    ),
  ]
}

function indent(text: string) {
  return text
    .trimEnd()
    .split("\n")
    .map((line) => `    ${line}`)
    .join("\n")
}
