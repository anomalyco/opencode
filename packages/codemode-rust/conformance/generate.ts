#!/usr/bin/env bun

// Regenerates conformance/cases/<name>.json by running every <name>.js through the reference CodeMode.
// Usage: bun conformance/generate.ts [reference] — the reference CodeMode package directory, from the argument,
// CODEMODE_REF, or by default ../codemode relative to this workspace.
//
// A case may start with header comments that set its inputs:
//   // @bindings {"event": {"type": "init"}}
//   // @limits {"max_tool_calls": 2}

import { readdirSync, readFileSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"

const override = process.argv[2] ?? process.env.CODEMODE_REF
const pkg = override === undefined ? resolve(import.meta.dir, "../../codemode") : resolve(override)
const { Effect, Schema } = await import(Bun.resolveSync("effect", join(pkg, "src")))
const { CodeMode, Tool, toolError } = await import(join(pkg, "src/index.ts"))

const tools = {
  echo: Tool.make({
    description: "Echo an id",
    input: Schema.Struct({ id: Schema.Number }),
    output: Schema.Number,
    execute: ({ id }: { id: number }) => Effect.succeed(id),
  }),
  fail: Tool.make({
    description: "Always fails",
    input: Schema.Struct({}),
    output: Schema.Number,
    execute: () => Effect.fail(toolError("boom")),
  }),
  git: {
    status: Tool.make({
      description: "Working tree status",
      input: Schema.Struct({}),
      output: Schema.Struct({ branch: Schema.String, dirty: Schema.Boolean }),
      execute: () => Effect.succeed({ branch: "main", dirty: true }),
    }),
  },
}

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
  const bindings = header(code, "bindings") ?? {}
  const limits = header(code, "limits")
  const runtime = CodeMode.make({
    tools,
    ...(limits === undefined ? {} : { limits: { maxToolCalls: limits.max_tool_calls, timeoutMs: limits.timeout_ms } }),
  })
  const result = await Effect.runPromise(runtime.execute(code, bindings))
  const expected = {
    bindings,
    ...(limits === undefined ? {} : { limits }),
    ...(result.ok ? { ok: true, value: result.value } : { ok: false, kind: result.error.kind }),
    logs: result.logs ?? [],
  }
  writeFileSync(join(dir, `${name}.json`), JSON.stringify(expected, null, 2) + "\n")
  console.log(`${name.padEnd(36)} ${result.ok ? "ok" : result.error.kind}`)
}
