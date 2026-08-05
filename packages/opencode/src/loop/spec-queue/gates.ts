// Gate state machine and evaluators for loop-spec-queue (design D3).
//
// Gates ratchet one way per change: implement → test → verify → commit. Any
// failure returns to implement carrying the failure output; three consecutive
// failures of the SAME gate quarantine the change (relentless mode, D8).
//
// Evaluators never run commands themselves — they take an `exec` callback so
// tests can drive them hermetically and the driver can supply the real
// spawner with the repo's working directory and timeouts.
import fs from "fs"
import path from "path"

import { allChecked, parseTasksMd } from "./tasks-md"
import type { QueueChange } from "./queue"
import type { Gate } from "./brief"

export type { Gate }

export const GATE_ORDER: readonly Gate[] = ["implement", "test", "verify", "commit"]

/** Same-gate consecutive failures tolerated before quarantine. */
export const GateFailureLimit = 3

export interface ExecResult {
  code: number
  output: string
}

export type Exec = (command: string) => Promise<ExecResult>

export interface GateOutcome {
  gate: Gate
  passed: boolean
  /** what failed, verbatim — becomes brief context or blocker detail */
  output: string
}

export interface GateOptions {
  /** repo test command, e.g. "bun test" */
  testCommand: string
  /** typecheck command run first in the verify gate */
  verifyCommand: string
  /** default branch that the commit gate must never touch */
  defaultBranch: string
}

/** implement passes when every checkbox in tasks.md is checked (re-read from disk). */
export function evaluateImplement(change: QueueChange): GateOutcome {
  const file = path.join(change.directory, "tasks.md")
  const items = fs.existsSync(file) ? parseTasksMd(fs.readFileSync(file, "utf8")) : []
  if (allChecked(items)) return { gate: "implement", passed: true, output: "" }
  const unchecked = items.filter((item) => !item.checked)
  return {
    gate: "implement",
    passed: false,
    output: `unchecked tasks remain: ${unchecked.map((item) => item.id || item.text.slice(0, 40)).join(", ")}`,
  }
}

export async function evaluateTest(exec: Exec, options: GateOptions): Promise<GateOutcome> {
  const result = await exec(options.testCommand)
  return { gate: "test", passed: result.code === 0, output: result.code === 0 ? "" : result.output }
}

/** verify runs the typecheck plus each task's backtick Validation command. */
export async function evaluateVerify(exec: Exec, change: QueueChange, options: GateOptions): Promise<GateOutcome> {
  const failures: string[] = []
  const typecheck = await exec(options.verifyCommand)
  if (typecheck.code !== 0) failures.push(`\`${options.verifyCommand}\` exited ${typecheck.code}:\n${typecheck.output}`)

  const file = path.join(change.directory, "tasks.md")
  const items = fs.existsSync(file) ? parseTasksMd(fs.readFileSync(file, "utf8")) : []
  const seen = new Set<string>()
  for (const item of items) {
    if (!item.validation || seen.has(item.validation)) continue
    seen.add(item.validation)
    const result = await exec(item.validation)
    if (result.code !== 0) {
      failures.push(
        `task ${item.id || item.text.slice(0, 40)}: \`${item.validation}\` exited ${result.code}:\n${result.output}`,
      )
    }
  }
  return { gate: "verify", passed: failures.length === 0, output: failures.join("\n\n") }
}

/**
 * commit passes when a commit containing the change's work exists on a
 * non-default branch. Checked via exec so the driver decides the git surface.
 */
export async function evaluateCommit(exec: Exec, change: QueueChange, options: GateOptions): Promise<GateOutcome> {
  const branch = await exec("git rev-parse --abbrev-ref HEAD")
  const name = branch.output.trim()
  if (branch.code !== 0) return { gate: "commit", passed: false, output: branch.output }
  if (name === options.defaultBranch) {
    return {
      gate: "commit",
      passed: false,
      output: `still on default branch "${name}" — commit belongs on loop/${change.slug}`,
    }
  }
  const touched = await exec(`git log -1 --name-only -- openspec/changes/${change.slug}`)
  if (touched.code !== 0 || touched.output.trim() === "") {
    return {
      gate: "commit",
      passed: false,
      output: `no commit touching openspec/changes/${change.slug} found on ${name}`,
    }
  }
  const dirty = await exec("git status --porcelain")
  if (dirty.output.trim() !== "") {
    return { gate: "commit", passed: false, output: `working tree still dirty:\n${dirty.output}` }
  }
  return { gate: "commit", passed: true, output: "" }
}

export function nextGate(gate: Gate): Gate | undefined {
  const index = GATE_ORDER.indexOf(gate)
  return GATE_ORDER[index + 1]
}

export * as SpecQueueGates from "./gates"
