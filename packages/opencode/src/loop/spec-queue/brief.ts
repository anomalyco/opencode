// Per-iteration brief for a queue loop: the change's own documents plus the
// next unchecked task, and — when the fleet has idle capacity — a fan-out
// nudge (design D9: awareness only; placement machinery does the rest).
import fs from "fs"
import path from "path"

import { uncheckedTasks } from "./tasks-md"
import type { QueueChange } from "./queue"

export type Gate = "implement" | "test" | "verify" | "commit"

export interface BriefInput {
  change: QueueChange
  gate: Gate
  /** failure output from the previous gate evaluation, when returning to implement */
  failure?: { gate: Gate; output: string }
  /** names of idle local peer providers; empty → no fan-out nudge */
  idlePeers: readonly string[]
  /**
   * Other sessions working in this directory right now, already described.
   * Empty means the repo is quiet — the paragraph is then omitted entirely,
   * because a collision warning that fires constantly stops being read.
   */
  peers?: readonly string[]
  /**
   * Agent bound to this gate, when one resolved. The nudge names it instead of
   * gesturing at "the task tool" — an instruction naming nobody is one the
   * model can ignore at no cost, which is exactly what happened. Absent means
   * the repo has no such persona, and no fan-out instruction is emitted at all:
   * telling a model to delegate to an agent that does not exist is worse than
   * telling it nothing.
   */
  persona?: string
  /**
   * Corrections given while the run was already going (`/nudge`), in the order
   * given. They outrank `guidance`: guidance is what the run started with,
   * these arrived because it was going the wrong way.
   */
  steers?: readonly string[]
  /**
   * Optional standing instruction from the operator, repeated on every
   * iteration of the run. Steers HOW the work is done ("prefer small commits",
   * "leave the CLI alone"); it never decides WHAT is worked, because that is
   * derived from the checkboxes on disk and must stay that way.
   */
  guidance?: string
}

function readIfExists(file: string): string | undefined {
  if (!fs.existsSync(file)) return undefined
  return fs.readFileSync(file, "utf8")
}

function specFiles(changeDir: string): string[] {
  const specsDir = path.join(changeDir, "specs")
  if (!fs.existsSync(specsDir)) return []
  const out: string[] = []
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (entry.name === "spec.md") out.push(full)
    }
  }
  walk(specsDir)
  return out.sort()
}

const GATE_INSTRUCTIONS: Record<Gate, string> = {
  implement: [
    "You are in the IMPLEMENT gate. Work the next unchecked task to completion,",
    "check it off in tasks.md with a short note of what you verified, and keep the",
    "change's own Validation commands passing as you go. Do not push, tag, publish,",
    "or deploy anything.",
  ].join(" "),
  test: [
    "You are in the TEST gate. Run the repository test suite relevant to this change",
    "and fix failures your change caused. Do not weaken or delete tests to make them pass.",
  ].join(" "),
  verify: [
    "You are in the VERIFY gate. Run the typecheck and each task's stated Validation",
    "command; fix what fails. Do not check off tasks that do not pass their validation.",
  ].join(" "),
  commit: [
    "You are in the COMMIT gate. Commit the change's work to a non-default branch",
    "named loop/<change-slug>. Never commit to the default branch and never push.",
  ].join(" "),
}

/** Composes the brief text sent as the iteration's prompt. */
export function buildBrief(input: BriefInput): string {
  const { change } = input
  const parts: string[] = []

  parts.push(
    [
      `You are working the openspec change "${change.slug}" as part of an unattended queue run.`,
      `The change lives at ${change.directory}.`,
      GATE_INSTRUCTIONS[input.gate],
    ].join("\n"),
  )

  if (input.failure) {
    parts.push(
      [
        `The previous ${input.failure.gate.toUpperCase()} gate failed. Fix the cause before anything else.`,
        "Failure output:",
        "```",
        input.failure.output.trim().slice(0, 8_000),
        "```",
      ].join("\n"),
    )
  }

  // Placed before the change documents so a long proposal cannot bury it, and
  // repeated every iteration because each one runs in a fresh child session
  // with no memory of the last.
  if (input.guidance?.trim()) {
    parts.push(`Standing instruction from the operator, applies to every iteration:\n${input.guidance.trim()}`)
  }

  // After the standing instruction, because these are corrections TO it: the
  // operator said them after watching the run go wrong, so where the two
  // conflict these win.
  if (input.steers && input.steers.length > 0) {
    parts.push(
      [
        "Corrections from the operator, given while this run was already going.",
        "They override the standing instruction above wherever the two disagree:",
        "",
        ...input.steers.map((steer) => `- ${steer}`),
      ].join("\n"),
    )
  }

  const next = uncheckedTasks(change.tasks)[0]
  if (next) {
    parts.push(`Next unchecked task: ${next.id ? `${next.id} ` : ""}${next.text}`)
  }

  const proposal = readIfExists(path.join(change.directory, "proposal.md"))
  if (proposal) parts.push(`## proposal.md\n\n${proposal}`)

  const tasks = readIfExists(path.join(change.directory, "tasks.md"))
  if (tasks) parts.push(`## tasks.md\n\n${tasks}`)

  for (const file of specFiles(change.directory)) {
    parts.push(`## ${path.relative(change.directory, file)}\n\n${fs.readFileSync(file, "utf8")}`)
  }

  if (input.peers && input.peers.length > 0) {
    parts.push(
      [
        `Another agent is working in this repository right now — you are not alone in this checkout.`,
        "Two agents editing one working tree is a real failure here, not a hypothetical:",
        "",
        ...input.peers.map((peer) => `- ${peer}`),
        "",
        "Before you touch shared state — a branch, the git index, a migration, a manifest —",
        "consider whether that session is already doing it. If its title overlaps this change,",
        "say so in your reply rather than racing it. You cannot read its messages.",
      ].join("\n"),
    )
  }

  if (input.idlePeers.length > 0 && input.persona) {
    parts.push(
      [
        `Fleet capacity: ${input.idlePeers.length} idle local provider${input.idlePeers.length === 1 ? "" : "s"}`,
        `(${input.idlePeers.join(", ")}) can take delegated work right now. Where this change's`,
        `tasks are independent of each other, delegate them with the task tool using`,
        `subagent_type "${input.persona}" — one call per independent slice, and placement will`,
        "put them on idle peers automatically. Keep work that shares a file in one call.",
      ].join(" "),
    )
  }

  return parts.join("\n\n")
}

export * as SpecQueueBrief from "./brief"
