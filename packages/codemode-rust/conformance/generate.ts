#!/usr/bin/env bun

// Regenerates conformance/cases/<name>.json by running every <name>.js through the reference's language layer
// (`Language.Runtime.make`).
// Usage: bun conformance/generate.ts [reference] — the reference CodeMode package directory, from the argument,
// CODEMODE_REF, or by default ../codemode relative to this workspace.
//
// Host globals: only `tools`, the namespace of conformance/reference.ts (`tools.echo`, `tools.fail`, `tools.git.status`,
// all async; any other path an async function that rejects with NotFound). No `modules`.
//
// A case may start with header comments that set its inputs:
//   // @bindings {"event": {"type": "init"}}            the program's bindings (default `{}`)
//   // @limits {"timeout_ms": 50, "max_output_bytes": 9}  the runtime's `limits` (default none)
//   // @translate {"functions": "drop", "promises": "await"}  the runtime's `translate` (default the reference's:
//                                                          both "error")
//   // @platform "linux"
// A case with @platform depends on the system libm or compiler, so it is recorded and checked only on that platform
// (`process.platform`). Elsewhere this keeps its recorded outcome but rewrites it in the current format, and fails
// when the case needs a run on its platform (its inputs changed): see `refreshSkipped`.
//
// Each <name>.json: `{ bindings, limits?, translate?, ok: true, value } | { bindings, limits?, translate?, ok: false,
// kind }`, then `logs` (the result's logs, `[]` when none) and `metadata` (the result's `run.metadata`: always `null`
// here, as `tools` keeps no run state).

import { readdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { reference, toolsGlobal } from "./reference.ts"

const ref = await reference(process.argv[2] ?? process.env.CODEMODE_REF)
const Effect = ref.Effect
const tools = toolsGlobal(ref)

const header = (code: string, tag: string) => {
  const line = code.split("\n").find((l) => l.startsWith(`// @${tag} `))
  return line === undefined ? undefined : JSON.parse(line.slice(`// @${tag} `.length))
}

const dir = join(import.meta.dir, "cases")

// A case recorded only on another platform keeps its recorded outcome here, but follows the format the cases are
// written in: its fields are rewritten in the order below, and a field this generator can fill without running the
// case is filled (`metadata` is always null, as `tools` keeps no run state). When its inputs changed, or its outcome
// is missing, it needs a run on its platform: it is listed in `stale`, and the generator fails.
const stale: Array<string> = []
const refreshSkipped = (name: string, inputs: { bindings: unknown; limits: unknown; translate: unknown }): boolean => {
  const path = join(dir, `${name}.json`)
  const before = readFileSync(path, "utf8")
  const recorded = JSON.parse(before)
  const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)
  const outcome =
    recorded.ok === true && "value" in recorded
      ? { ok: true, value: recorded.value }
      : recorded.ok === false && typeof recorded.kind === "string"
        ? { ok: false, kind: recorded.kind }
        : undefined
  if (
    outcome === undefined ||
    !Array.isArray(recorded.logs) ||
    ("metadata" in recorded && recorded.metadata !== null) ||
    !same(recorded.bindings, inputs.bindings) ||
    !same(recorded.limits, inputs.limits) ||
    !same(recorded.translate, inputs.translate)
  ) {
    stale.push(`  ${name}`)
    return false
  }
  const expected = {
    bindings: inputs.bindings,
    ...(inputs.limits === undefined ? {} : { limits: inputs.limits }),
    ...(inputs.translate === undefined ? {} : { translate: inputs.translate }),
    ...outcome,
    logs: recorded.logs,
    metadata: null,
  }
  const after = JSON.stringify(expected, null, 2) + "\n"
  if (after === before) return false
  writeFileSync(path, after)
  return true
}
const names = readdirSync(dir)
  .filter((f) => f.endsWith(".js"))
  .map((f) => f.slice(0, -3))
  .sort()

for (const name of names) {
  const code = readFileSync(join(dir, `${name}.js`), "utf8")
  const platform = header(code, "platform")
  const bindings = header(code, "bindings") ?? {}
  const limits = header(code, "limits")
  const translate = header(code, "translate")
  if (platform !== undefined && platform !== process.platform) {
    console.log(
      `${name.padEnd(36)} ${refreshSkipped(name, { bindings, limits, translate }) ? "reformatted" : "skipped"} (${platform} only)`,
    )
    continue
  }
  const runtime = ref.Language.Runtime.make({
    globals: () => ({ tools }),
    ...(limits === undefined
      ? {}
      : { limits: { timeoutMs: limits.timeout_ms, maxOutputBytes: limits.max_output_bytes } }),
    ...(translate === undefined ? {} : { translate }),
  })
  const result = await Effect.runPromise(runtime.execute(code, { bindings }))
  const expected = {
    bindings,
    ...(limits === undefined ? {} : { limits }),
    ...(translate === undefined ? {} : { translate }),
    ...(result.ok ? { ok: true, value: result.value } : { ok: false, kind: result.error.kind }),
    logs: result.logs ?? [],
    metadata: result.metadata,
  }
  writeFileSync(join(dir, `${name}.json`), JSON.stringify(expected, null, 2) + "\n")
  console.log(`${name.padEnd(36)} ${result.ok ? "ok" : result.error.kind}`)
}

if (stale.length > 0) {
  console.error(
    `These cases are recorded only on another platform, and their expectations need a run there (regenerate on it):\n${stale.join("\n")}`,
  )
  process.exit(1)
}
