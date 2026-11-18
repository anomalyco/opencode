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
// (`process.platform`); elsewhere this leaves its expectation as it is.
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
const names = readdirSync(dir)
  .filter((f) => f.endsWith(".js"))
  .map((f) => f.slice(0, -3))
  .sort()

for (const name of names) {
  const code = readFileSync(join(dir, `${name}.js`), "utf8")
  const platform = header(code, "platform")
  if (platform !== undefined && platform !== process.platform) {
    console.log(`${name.padEnd(36)} skipped (${platform} only)`)
    continue
  }
  const bindings = header(code, "bindings") ?? {}
  const limits = header(code, "limits")
  const translate = header(code, "translate")
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
