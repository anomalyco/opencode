import path from "path"
import { Schema } from "effect"
import { Glob } from "@bolt-ai/core/util/glob"
import { Filesystem } from "@/util/filesystem"
import { ConfigMarkdown } from "@/config/markdown"
import { ConfigParse } from "@/config/parse"

// Eval cases are markdown files with YAML frontmatter: the frontmatter carries
// the model/agent overrides and the grading checks, the body is the prompt
// handed to the agent. Mirrors the agent/command config file convention.

export const Check = Schema.Union([
  Schema.Struct({
    type: Schema.Literal("file_exists"),
    path: Schema.String,
  }),
  Schema.Struct({
    type: Schema.Literal("file_contains"),
    path: Schema.String,
    text: Schema.optional(Schema.String),
    pattern: Schema.optional(Schema.String),
  }),
  Schema.Struct({
    type: Schema.Literal("command"),
    run: Schema.String,
    timeout: Schema.optional(Schema.Number),
  }),
])
export type Check = typeof Check.Type

export const Info = Schema.Struct({
  name: Schema.String,
  description: Schema.optional(Schema.String),
  model: Schema.optional(Schema.String),
  agent: Schema.optional(Schema.String),
  timeout: Schema.optional(Schema.Number),
  files: Schema.optional(Schema.Record(Schema.String, Schema.String)),
  expect: Schema.mutable(Schema.Array(Check)),
  prompt: Schema.String,
})
export type Info = typeof Info.Type

// Expands targets into a sorted, deduplicated list of case files: directories
// are scanned recursively for *.md, files are taken as-is. Unknown paths are
// returned separately so the caller can fail with a user-visible message.
export async function discover(targets: string[]) {
  const found: string[] = []
  const missing: string[] = []
  for (const target of targets) {
    const resolved = path.resolve(target)
    const stat = Filesystem.stat(resolved)
    if (!stat) {
      missing.push(target)
      continue
    }
    if (stat.isDirectory()) {
      found.push(...(await Glob.scan("**/*.md", { cwd: resolved, absolute: true, dot: true, symlink: true })))
      continue
    }
    found.push(resolved)
  }
  return { files: [...new Set(found)].sort(), missing }
}

export async function load(file: string): Promise<Info> {
  const md = await ConfigMarkdown.parse(file)
  const config = {
    name: path.basename(file, ".md"),
    ...md.data,
    prompt: md.content.trim(),
  }
  return ConfigParse.schema(Info, config, file)
}

export interface CheckResult {
  check: Check
  passed: boolean
  detail?: string
}

export function describeCheck(check: Check) {
  if (check.type === "file_exists") return `file_exists ${check.path}`
  if (check.type === "file_contains")
    return `file_contains ${check.path} · ${check.pattern ?? check.text ?? "(no matcher)"}`
  return `command ${check.run}`
}

export async function runCheck(check: Check, workspace: string): Promise<CheckResult> {
  if (check.type === "file_exists") {
    const passed = await Filesystem.exists(path.join(workspace, check.path))
    return { check, passed, detail: passed ? undefined : "file not found" }
  }

  if (check.type === "file_contains") {
    if (check.text === undefined && check.pattern === undefined) {
      return { check, passed: false, detail: "file_contains requires text or pattern" }
    }
    const target = path.join(workspace, check.path)
    if (!(await Filesystem.exists(target))) {
      return { check, passed: false, detail: "file not found" }
    }
    const content = await Filesystem.readText(target)
    const passed =
      check.pattern !== undefined
        ? new RegExp(check.pattern, "m").test(content)
        : check.text !== undefined && content.includes(check.text)
    return { check, passed, detail: passed ? undefined : "no match" }
  }

  const proc = Bun.spawn(["bash", "-c", check.run], {
    cwd: workspace,
    stdout: "pipe",
    stderr: "pipe",
    timeout: (check.timeout ?? 120) * 1000,
  })
  const stdout = await new Response(proc.stdout).text()
  const stderr = await new Response(proc.stderr).text()
  const exitCode = await proc.exited
  if (exitCode === 0) return { check, passed: true }
  const output = (stdout + stderr).trim()
  return {
    check,
    passed: false,
    detail: `exit ${exitCode}${output ? `: ${output.slice(0, 400)}` : ""}`,
  }
}
