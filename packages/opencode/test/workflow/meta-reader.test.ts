import { describe, expect, test } from "bun:test"
import os from "os"
import path from "path"
import { MetaReader } from "@/workflow/meta-reader"

const FAKE_PATH = path.join(os.tmpdir(), "fake-workflow.ts")

describe("MetaReader", () => {
  test("extracts literal meta from named exports (export const meta / export function run)", () => {
    const source = `export const meta = {
  name: "Hello",
  description: "Test workflow",
  phases: ["start", "end"],
  arguments: { value: { type: "number", description: "A value" } }
}
export async function run(args, ctx) { return { ok: true } }
`
    const result = MetaReader.read(source, FAKE_PATH)
    expect(result.valid).toBe(true)
    if (!result.valid) throw new Error("expected valid")
    expect(result.meta.name).toBe("Hello")
    expect(result.meta.description).toBe("Test workflow")
    // Phases normalize to the internal object shape (Task 15): strings → { title }.
    expect(result.meta.phases).toEqual([{ title: "start" }, { title: "end" }])
    expect(result.meta.arguments).toEqual({ value: { type: "number", description: "A value" } })
  })

  test("extracts whenToUse from literal meta (QW4)", () => {
    const source = `export const meta = {
  name: "Deploy",
  description: "Deploy the app.",
  whenToUse: "When the user explicitly asks to ship to production."
}
export async function run(args, ctx) { return { ok: true } }
`
    const result = MetaReader.read(source, FAKE_PATH)
    expect(result.valid).toBe(true)
    if (!result.valid) throw new Error("expected valid")
    expect(result.meta.whenToUse).toBe("When the user explicitly asks to ship to production.")
  })

  test("extracts literal meta from a default object literal (export default { meta, run })", () => {
    const source = `export default {
  meta: { name: "Typed Workflow", phases: ["run"] },
  async run(args, ctx) { return { ok: true } }
}
`
    const result = MetaReader.read(source, FAKE_PATH)
    expect(result.valid).toBe(true)
    if (!result.valid) throw new Error("expected valid")
    expect(result.meta.name).toBe("Typed Workflow")
    expect(result.meta.phases).toEqual([{ title: "run" }])
  })

  test("extracts literal meta from an export default workflow({ ... }) call", () => {
    const source = `import { workflow } from "@opencode-ai/plugin/workflow"
export default workflow({
  name: "Called",
  description: "Built via helper",
  phases: ["one"],
  arguments: { x: { type: "string" } },
  async run(args, ctx) { return { ok: true } }
})
`
    const result = MetaReader.read(source, FAKE_PATH)
    expect(result.valid).toBe(true)
    if (!result.valid) throw new Error("expected valid")
    expect(result.meta.name).toBe("Called")
    expect(result.meta.description).toBe("Built via helper")
    expect(result.meta.phases).toEqual([{ title: "one" }])
    expect(result.meta.arguments).toEqual({ x: { type: "string" } })
  })

  test("does NOT execute module top-level code (no import, no side effects)", async () => {
    const marker = path.join(os.tmpdir(), `meta-reader-marker-${Math.random().toString(16).slice(2)}`)
    // Top-level await with a real side effect: if the reader were to import/run
    // the module, this marker file would be written. Static extraction must not.
    const source = `await Bun.write(${JSON.stringify(marker)}, "executed")
export const meta = { name: "SideEffect" }
export async function run(args, ctx) { return { ok: true } }
`
    const result = MetaReader.read(source, FAKE_PATH)
    expect(result.valid).toBe(true)
    if (!result.valid) throw new Error("expected valid")
    expect(result.meta.name).toBe("SideEffect")
    // The marker must NOT exist: top-level code was never run.
    expect(await Bun.file(marker).exists()).toBe(false)
  })

  test("non-statically-analyzable meta is reported invalid (no throw)", () => {
    const source = `export const meta = { name: process.env.SECRET_NAME }
export async function run(args, ctx) { return { ok: true } }
`
    const result = MetaReader.read(source, FAKE_PATH)
    expect(result.valid).toBe(false)
    if (result.valid) throw new Error("expected invalid")
    expect(result.error).toContain("statically analyzable")
  })

  test("computed property name (name: someFn()) is reported invalid", () => {
    const source = `function compute() { return "x" }
export const meta = { name: compute() }
export async function run(args, ctx) { return { ok: true } }
`
    const result = MetaReader.read(source, FAKE_PATH)
    expect(result.valid).toBe(false)
    if (result.valid) throw new Error("expected invalid")
    expect(result.error).toContain("statically analyzable")
  })

  test("meta that fails the schema (missing name) is reported invalid", () => {
    const source = `export const meta = { description: "no name here" }
export async function run(args, ctx) { return { ok: true } }
`
    const result = MetaReader.read(source, FAKE_PATH)
    expect(result.valid).toBe(false)
    if (result.valid) throw new Error("expected invalid")
    expect(result.error).toBeTruthy()
  })

  test("a file with no default export and no meta export is reported invalid", () => {
    const source = `export async function run(args, ctx) { return { ok: true } }
`
    const result = MetaReader.read(source, FAKE_PATH)
    expect(result.valid).toBe(false)
    if (result.valid) throw new Error("expected invalid")
    expect(result.error).toBeTruthy()
  })

  test("negative and boolean literals are extracted faithfully", () => {
    const source = `export const meta = {
  name: "Literals",
  arguments: { flag: { type: "boolean", default: false }, n: { type: "number", default: -3 } }
}
export async function run(args, ctx) { return { ok: true } }
`
    const result = MetaReader.read(source, FAKE_PATH)
    expect(result.valid).toBe(true)
    if (!result.valid) throw new Error("expected valid")
    expect(result.meta.arguments).toEqual({
      flag: { type: "boolean", default: false },
      n: { type: "number", default: -3 },
    })
  })

  test("`as const` on the whole meta and on a nested array is extracted (idiomatic TS)", () => {
    const source = `export const meta = {
  name: "Const",
  phases: ["a", "b"] as const,
  arguments: { x: { type: "string" } }
} as const
export async function run(args, ctx) { return { ok: true } }
`
    const result = MetaReader.read(source, FAKE_PATH)
    expect(result.valid).toBe(true)
    if (!result.valid) throw new Error("expected valid")
    expect(result.meta.name).toBe("Const")
    expect(result.meta.phases).toEqual([{ title: "a" }, { title: "b" }])
    expect(result.meta.arguments).toEqual({ x: { type: "string" } })
  })

  test("`satisfies` and parenthesized expressions are unwrapped transparently", () => {
    const source = `export const meta = ({
  name: "Sat",
  phases: (["one"]) satisfies readonly string[]
}) satisfies Record<string, unknown>
export async function run(args, ctx) { return { ok: true } }
`
    const result = MetaReader.read(source, FAKE_PATH)
    expect(result.valid).toBe(true)
    if (!result.valid) throw new Error("expected valid")
    expect(result.meta.name).toBe("Sat")
    expect(result.meta.phases).toEqual([{ title: "one" }])
  })

  test("more than one default export is reported invalid (ambiguous)", () => {
    const source = `export default { meta: { name: "First" }, run() {} }
export default { meta: { name: "Second" }, run() {} }
`
    const result = MetaReader.read(source, FAKE_PATH)
    expect(result.valid).toBe(false)
    if (result.valid) throw new Error("expected invalid")
    expect(result.error).toBeTruthy()
  })

  test("a syntax-error file is reported invalid, never crashes", () => {
    const source = `export const meta = {`
    const result = MetaReader.read(source, FAKE_PATH)
    expect(result.valid).toBe(false)
    if (result.valid) throw new Error("expected invalid")
    expect(result.error).toBeTruthy()
  })

  test("a template string WITH substitution in meta is reported invalid", () => {
    const source = `const suffix = "x"
export const meta = { name: \`Hello-\${suffix}\` }
export async function run(args, ctx) { return { ok: true } }
`
    const result = MetaReader.read(source, FAKE_PATH)
    expect(result.valid).toBe(false)
    if (result.valid) throw new Error("expected invalid")
    expect(result.error).toContain("statically analyzable")
  })

  // Task 15: structured phases. A phase entry may be an object literal
  // `{ title, detail?, model? }` alongside plain strings. The reader extracts it
  // statically (object literals only — same static-analyzability rule) and the
  // schema NORMALIZES every phase to the internal object shape on decode, so a
  // string phase reads back as `{ title }` and an object phase keeps its fields.
  test("structured phase objects are read statically and normalized to objects", () => {
    const source = `export const meta = {
  name: "Structured",
  phases: ["plan", { title: "verify", detail: "x", model: "stub/mini" }]
}
export async function run(args, ctx) { return { ok: true } }
`
    const result = MetaReader.read(source, FAKE_PATH)
    expect(result.valid).toBe(true)
    if (!result.valid) throw new Error("expected valid")
    // Always objects internally: the string "plan" normalizes to { title: "plan" },
    // and the object phase keeps title/detail/model.
    expect(result.meta.phases?.[0]).toEqual({ title: "plan" })
    expect(result.meta.phases?.[1].title).toBe("verify")
    expect(result.meta.phases?.[1]).toEqual({ title: "verify", detail: "x", model: "stub/mini" })
  })

  // A phase OBJECT missing the required `title` is invalid meta. The rule is
  // statically analyzable (the object literal is read, then rejected by the same
  // Meta schema the engine uses), so it reports invalid rather than throwing.
  test("a phase object without a title is reported invalid meta", () => {
    const source = `export const meta = {
  name: "BadPhase",
  phases: ["ok", { detail: "no title here", model: "x/y" }]
}
export async function run(args, ctx) { return { ok: true } }
`
    const result = MetaReader.read(source, FAKE_PATH)
    expect(result.valid).toBe(false)
    if (result.valid) throw new Error("expected invalid")
    expect(result.error).toBeTruthy()
  })
})
