import { describe, expect, test } from "bun:test"
import os from "os"
import path from "path"
import { SourceLint } from "@/workflow/source-lint"

const FAKE_PATH = path.join(os.tmpdir(), "fake-workflow.ts")

// Item 23 (Stufe 2): the static source lint runs purely on the AST (like the
// MetaReader) and never executes the module. These tests pin the rule set:
// node builtins via import/require/dynamic import, Bun.* capability members,
// process.env reads, fetch calls, and non-literal dynamic imports.
describe("SourceLint", () => {
  test("flags a static node:fs import with its line", () => {
    const source = `import fs from "node:fs"
export const meta = { name: "x" }
export async function run(args, ctx) { return {} }
`
    const { findings } = SourceLint.lint(source, FAKE_PATH)
    expect(findings).toHaveLength(1)
    expect(findings[0].rule).toBe("node-builtin-import")
    expect(findings[0].line).toBe(1)
    expect(findings[0].text).toContain("node:fs")
  })

  test("flags bare and subpath builtin specifiers (fs/promises, child_process)", () => {
    const source = `import { readFile } from "fs/promises"
import { spawn } from "child_process"
export const meta = { name: "x" }
export async function run(args, ctx) { return {} }
`
    const { findings } = SourceLint.lint(source, FAKE_PATH)
    expect(findings.map((f) => f.rule)).toEqual(["node-builtin-import", "node-builtin-import"])
  })

  test("flags child_process via require", () => {
    const source = `export const meta = { name: "x" }
export async function run(args, ctx) {
  const cp = require("child_process")
  return {}
}
`
    const { findings } = SourceLint.lint(source, FAKE_PATH)
    expect(findings).toHaveLength(1)
    expect(findings[0].rule).toBe("node-builtin-require")
    expect(findings[0].line).toBe(3)
  })

  test("flags a dynamic import of a builtin and a non-literal dynamic import", () => {
    const source = `export const meta = { name: "x" }
export async function run(args, ctx) {
  const vm = await import("node:vm")
  const dyn = await import(args.module)
  return {}
}
`
    const { findings } = SourceLint.lint(source, FAKE_PATH)
    expect(findings.map((f) => f.rule)).toEqual(["node-builtin-import", "dynamic-import"])
    expect(findings[0].line).toBe(3)
    expect(findings[1].line).toBe(4)
  })

  test("flags fetch calls and Bun capability members (spawn/write/file/$)", () => {
    const source = `export const meta = { name: "x" }
export async function run(args, ctx) {
  const res = await fetch("https://example.com")
  Bun.spawn(["ls"])
  await Bun.write("out.txt", "data")
  const f = Bun.file("in.txt")
  await Bun.$\`ls\`
  return {}
}
`
    const { findings } = SourceLint.lint(source, FAKE_PATH)
    expect(findings.map((f) => f.rule).toSorted()).toEqual(["bun-api", "bun-api", "bun-api", "bun-api", "fetch"])
  })

  test("flags process.env reads (property and element access)", () => {
    const source = `export const meta = { name: "x" }
export async function run(args, ctx) {
  const a = process.env.SECRET
  const b = process.env["TOKEN"]
  return {}
}
`
    const { findings } = SourceLint.lint(source, FAKE_PATH)
    // Each access contains exactly one process.env node.
    expect(findings.map((f) => f.rule)).toEqual(["process-env", "process-env"])
    expect(findings[0].line).toBe(3)
    expect(findings[1].line).toBe(4)
  })

  test("a clean script using only the ctx API yields zero findings", () => {
    const source = `export const meta = { name: "clean", description: "No capabilities.", phases: ["run"] }
export async function run(args, ctx) {
  ctx.setPhase("run")
  const a = await ctx.agent({ prompt: "do work" })
  const sh = await ctx.shell("git status")
  ctx.log("done")
  return { a: a.text, code: sh.exitCode }
}
`
    const { findings } = SourceLint.lint(source, FAKE_PATH)
    expect(findings).toHaveLength(0)
  })

  test("non-flagged imports (relative, npm package, node:path) are not flagged", () => {
    const source = `import helper from "./helper"
import lodash from "lodash"
import path from "node:path"
export const meta = { name: "x" }
export async function run(args, ctx) { return {} }
`
    const { findings } = SourceLint.lint(source, FAKE_PATH)
    expect(findings).toHaveLength(0)
  })
})
