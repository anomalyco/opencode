import { isDeepStrictEqual } from "node:util"
import { Effect, Schema } from "effect"
import { CodeMode, Tool } from "../src/index.js"
import { cases } from "../test/cpython/cases.js"

const groups = process.argv.slice(2)
// Only this reviewed allowlist is executed on the host, never a user-supplied file or program.
const upstream = await Promise.all(
  ["list_slice_3arg.py", "ifcond.py"].map(async (name) => ({
    group: "micropython",
    name,
    code: await Bun.file(new URL(`../test/cpython/micropython/${name}`, import.meta.url)).text(),
  })),
)
const fixtures = cases.concat(upstream)
const selected = fixtures.filter((c) => !groups.length || groups.includes(c.group))
for (const group of groups) {
  if (!fixtures.some((c) => c.group === group))
    throw new Error(`Unknown group: ${group}. Available: ${[...new Set(fixtures.map((c) => c.group))].join(", ")}`)
}
const python = process.env.PYTHON || Bun.which("python3") || Bun.which("python")
if (!python) throw new Error("Install CPython 3 or set PYTHON to its executable.")
const oracle = Bun.spawnSync([python, "-I", "-S", `${import.meta.dir}/cpython.py`], {
  stdin: Buffer.from(JSON.stringify(selected.map((c) => c.code))),
  stdout: "pipe",
  stderr: "pipe",
  timeout: 30_000,
})
if (oracle.exitCode !== 0) throw new Error(`CPython failed: ${oracle.stderr.toString()}`)
const reference = Schema.decodeUnknownSync(
  Schema.fromJsonString(
    Schema.Struct({
      python: Schema.String,
      results: Schema.Array(
        Schema.Struct({
          value: Schema.optionalKey(Schema.Json),
          raises: Schema.optionalKey(Schema.String),
          logs: Schema.Array(Schema.String),
          calls: Schema.Array(Schema.String),
        }),
      ),
    }),
  ),
)(oracle.stdout.toString())
if (reference.results.length !== selected.length) throw new Error("Missing reference results")

const runtime = CodeMode.make({
  language: "python",
  limits: { timeoutMs: 2_000 },
  tools: {
    echo: Tool.make({
      description: "Return the integer",
      input: Schema.Struct({ value: Schema.Int }),
      output: Schema.Int,
      execute: ({ value }) => Effect.succeed(value),
    }),
  },
})
let failures = 0
// Code Mode uses its shared range/type diagnostics for invalid Python values. A parse error,
// undefined function or timeout is not a passing negative test.
const errors = { TypeError: /^TypeError:/, ValueError: /^(ValueError|RangeError|TypeError):/ }
const totals = new Map<string, { passed: number; total: number }>()
for (const [i, c] of selected.entries()) {
  const group = totals.get(c.group) ?? { passed: 0, total: 0 }
  group.total++
  totals.set(c.group, group)
  const expected = reference.results[i]!
  if (expected.raises !== c.raises)
    throw new Error(
      `Invalid fixture ${c.name}: CPython raised ${expected.raises ?? "nothing"}, expected ${c.raises ?? "success"}`,
    )
  const actual = await Effect.runPromise(runtime.execute(c.code))
  if (
    (actual.ok
      ? !c.raises && isDeepStrictEqual(actual.value, expected.value)
      : c.raises && actual.error.kind === "ExecutionFailure" && errors[c.raises].test(actual.error.message)) &&
    isDeepStrictEqual(actual.logs ?? [], expected.logs) &&
    isDeepStrictEqual(
      actual.toolCalls.map((x) => x.name),
      expected.calls,
    )
  ) {
    group.passed++
    continue
  }
  failures++
  if (failures <= 10)
    console.error(
      `${c.group}/${c.name}\n${c.code}\nCPython: ${JSON.stringify(expected)}\nCode Mode: ${JSON.stringify(actual)}\n`,
    )
}
for (const [group, count] of totals) console.log(`${group}: ${count.passed}/${count.total}`)
console.log(
  `CPython ${reference.python}: ${selected.length - failures}/${selected.length} fixtures matched${failures ? ` (${failures} mismatches)` : ""}.`,
)
process.exitCode = failures ? 1 : 0
