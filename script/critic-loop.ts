#!/usr/bin/env bun
import { spawn } from "node:child_process"
import { existsSync } from "node:fs"
import path from "node:path"

type ShellResult = {
  code: number
  stdout: string
  stderr: string
}

type ReviewResult = {
  approved: boolean
  feedback: string
  required_changes?: string[]
  risk_level?: "low" | "medium" | "high"
}

type Options = {
  attempts: number
  allowDirty: boolean
  skipVerify: boolean
  verifyCmd: string
  planModel?: string
  buildModel?: string
  dir?: string
  diffMaxChars: number
  dryRun: boolean
}

const DEFAULT_VERIFY_CMD = "bun run lint && bun run typecheck"
const DEFAULT_OPENCODE_BIN = "bun run dev --"

function usage(): never {
  console.error(`Usage:
  bun run critic:loop -- "task prompt"
  bun run critic:loop -- --attempts 3 --dir . "task prompt"

Environment:
  OPENCODE_BIN                  Command prefix. Default: "${DEFAULT_OPENCODE_BIN}"
  OPENCODE_CRITIC_VERIFY_CMD    Verification command. Default: "${DEFAULT_VERIFY_CMD}"
  OPENCODE_CRITIC_PLAN_MODEL    Optional provider/model for plan reviewer
  OPENCODE_CRITIC_BUILD_MODEL   Optional provider/model for build executor

Examples:
  bun run critic:loop -- "Add a feature flag for critic loop"
  bun run critic:loop -- --skip-verify "Only draft the code change"
  OPENCODE_BIN=opencode bun run critic:loop -- "Fix failing typecheck"
`)
  process.exit(1)
}

function parseArgs(argv: string[]): { opts: Options; task: string } {
  const opts: Options = {
    attempts: 3,
    allowDirty: false,
    skipVerify: false,
    verifyCmd: process.env.OPENCODE_CRITIC_VERIFY_CMD || DEFAULT_VERIFY_CMD,
    planModel: process.env.OPENCODE_CRITIC_PLAN_MODEL,
    buildModel: process.env.OPENCODE_CRITIC_BUILD_MODEL,
    dir: undefined,
    diffMaxChars: 120_000,
    dryRun: false,
  }

  const taskParts: string[] = []

  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index]
    if (!arg) continue

    if (arg === "--help" || arg === "-h") usage()

    if (arg === "--attempts") {
      const next = argv[++index]
      const value = Number(next)
      if (!Number.isInteger(value) || value < 1 || value > 10) {
        throw new Error("--attempts must be an integer from 1 to 10")
      }
      opts.attempts = value
      continue
    }

    if (arg === "--dir") {
      const next = argv[++index]
      if (!next) throw new Error("--dir requires a path")
      opts.dir = next
      continue
    }

    if (arg === "--plan-model") {
      const next = argv[++index]
      if (!next) throw new Error("--plan-model requires provider/model")
      opts.planModel = next
      continue
    }

    if (arg === "--build-model") {
      const next = argv[++index]
      if (!next) throw new Error("--build-model requires provider/model")
      opts.buildModel = next
      continue
    }

    if (arg === "--verify-cmd") {
      const next = argv[++index]
      if (!next) throw new Error("--verify-cmd requires a shell command")
      opts.verifyCmd = next
      continue
    }

    if (arg === "--diff-max-chars") {
      const next = argv[++index]
      const value = Number(next)
      if (!Number.isInteger(value) || value < 1_000) {
        throw new Error("--diff-max-chars must be an integer >= 1000")
      }
      opts.diffMaxChars = value
      continue
    }

    if (arg === "--allow-dirty") {
      opts.allowDirty = true
      continue
    }

    if (arg === "--skip-verify") {
      opts.skipVerify = true
      continue
    }

    if (arg === "--dry-run") {
      opts.dryRun = true
      continue
    }

    taskParts.push(arg)
  }

  const task = taskParts.join(" ").trim()
  if (!task) usage()

  return { opts, task }
}

function resolveWorkspace(dir?: string) {
  return path.resolve(process.cwd(), dir ?? ".")
}

function shellQuote(value: string) {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

async function runShell(command: string, cwd: string, input?: string): Promise<ShellResult> {
  return await new Promise((resolve, reject) => {
    const child = spawn(command, {
      cwd,
      shell: process.platform === "win32" ? true : "/bin/sh",
      env: process.env,
      stdio: ["pipe", "pipe", "pipe"],
    })

    let stdout = ""
    let stderr = ""

    child.stdout.setEncoding("utf8")
    child.stderr.setEncoding("utf8")
    child.stdout.on("data", (chunk) => {
      stdout += chunk
    })
    child.stderr.on("data", (chunk) => {
      stderr += chunk
    })
    child.on("error", reject)
    child.on("close", (code) => {
      resolve({ code: code ?? 0, stdout, stderr })
    })

    if (input !== undefined) {
      child.stdin.write(input)
    }
    child.stdin.end()
  })
}

async function requireCleanWorkspace(cwd: string, allowDirty: boolean) {
  const result = await runShell("git status --short", cwd)
  if (result.code !== 0) {
    throw new Error(`Failed to read git status:\n${result.stderr || result.stdout}`)
  }

  if (!allowDirty && result.stdout.trim()) {
    throw new Error(
      [
        "Workspace is dirty before starting Critic Loop.",
        "Commit/stash existing changes or pass --allow-dirty if you intentionally want the reviewer to include them.",
        "",
        result.stdout.trim(),
      ].join("\n"),
    )
  }
}

async function getWorkspaceDiff(cwd: string, maxChars: number) {
  const status = await runShell("git status --short", cwd)
  const unstaged = await runShell("git diff -- .", cwd)
  const staged = await runShell("git diff --staged -- .", cwd)

  const full = [
    "## git status --short",
    status.stdout.trim() || "(clean)",
    "",
    "## git diff -- .",
    unstaged.stdout.trim() || "(no unstaged diff)",
    "",
    "## git diff --staged -- .",
    staged.stdout.trim() || "(no staged diff)",
  ].join("\n")

  if (full.length <= maxChars) {
    return { text: full, truncated: false }
  }

  return {
    text:
      full.slice(0, maxChars) +
      `\n\n[critic-loop: diff truncated at ${maxChars} characters. Increase --diff-max-chars if review needs more context.]`,
    truncated: true,
  }
}

function extractTextFromOpenCodeOutput(stdout: string) {
  const parts: string[] = []

  for (const line of stdout.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed) continue

    try {
      const event = JSON.parse(trimmed) as {
        type?: string
        part?: { type?: string; text?: string }
      }

      if (event.type === "text" && event.part?.type === "text" && typeof event.part.text === "string") {
        parts.push(event.part.text)
      }
    } catch {
      // Non-JSON output is handled below as a fallback.
    }
  }

  const text = parts.join("\n").trim()
  return text || stdout.trim()
}

function extractJsonObject(text: string) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const candidate = fenced?.[1]?.trim() ?? text.trim()

  try {
    return JSON.parse(candidate)
  } catch {
    const start = candidate.indexOf("{")
    const end = candidate.lastIndexOf("}")
    if (start === -1 || end === -1 || end <= start) {
      throw new Error(`Reviewer did not return JSON:\n${text}`)
    }
    return JSON.parse(candidate.slice(start, end + 1))
  }
}

function parseReview(text: string): ReviewResult {
  const raw = extractJsonObject(text)
  const approved = raw?.approved === true
  const feedback =
    typeof raw?.feedback === "string" && raw.feedback.trim()
      ? raw.feedback.trim()
      : approved
        ? "Approved."
        : "Rejected without detailed feedback."

  const requiredChanges = Array.isArray(raw?.required_changes)
    ? raw.required_changes.filter((item: unknown) => typeof item === "string")
    : undefined

  const riskLevel =
    raw?.risk_level === "low" || raw?.risk_level === "medium" || raw?.risk_level === "high" ? raw.risk_level : undefined

  return {
    approved,
    feedback,
    ...(requiredChanges?.length ? { required_changes: requiredChanges } : {}),
    ...(riskLevel ? { risk_level: riskLevel } : {}),
  }
}

function buildOpenCodeCommand(agent: "plan" | "build", opts: Options) {
  const opencodeBin = process.env.OPENCODE_BIN || DEFAULT_OPENCODE_BIN
  const model = agent === "plan" ? opts.planModel : opts.buildModel
  const args = [
    opencodeBin,
    "run",
    "--agent",
    shellQuote(agent),
    "--format",
    "json",
    ...(model ? ["--model", shellQuote(model)] : []),
    ...(opts.dir ? ["--dir", shellQuote(opts.dir)] : []),
    ...(agent === "build" ? ["--dangerously-skip-permissions"] : []),
  ]

  return args.join(" ")
}

async function runOpenCode(agent: "plan" | "build", prompt: string, opts: Options, cwd: string) {
  const command = buildOpenCodeCommand(agent, opts)

  if (opts.dryRun) {
    console.log(`[dry-run] ${command}`)
    return "[dry-run] no model call executed"
  }

  const result = await runShell(command, cwd, prompt)
  if (result.code !== 0) {
    throw new Error(
      [
        `OpenCode ${agent} agent failed with exit code ${result.code}.`,
        "STDERR:",
        result.stderr.trim() || "(empty)",
        "STDOUT:",
        result.stdout.trim() || "(empty)",
      ].join("\n"),
    )
  }

  return extractTextFromOpenCodeOutput(result.stdout)
}

async function runVerification(cwd: string, opts: Options) {
  if (opts.skipVerify) {
    return {
      ok: true,
      output: "Verification skipped by --skip-verify.",
    }
  }

  const result = await runShell(opts.verifyCmd, cwd)
  return {
    ok: result.code === 0,
    output: [
      `$ ${opts.verifyCmd}`,
      "",
      "STDOUT:",
      result.stdout.trim() || "(empty)",
      "",
      "STDERR:",
      result.stderr.trim() || "(empty)",
    ].join("\n"),
  }
}

function planPrompt(task: string) {
  return `You are the Plan Agent and technical lead for this repository.

Task:
${task}

Create a concrete implementation plan.

Rules:
- Do not edit files.
- Identify the smallest safe implementation path.
- Preserve existing behavior by default.
- List exact files likely to change.
- Define acceptance criteria.
- Flag risks before Build Agent starts.`
}

function buildPrompt(task: string, plan: string, attempt: number, feedback?: string) {
  return `You are the Build Agent for this repository.

Original task:
${task}

Approved implementation plan:
${plan}

Attempt:
${attempt}

${feedback ? `Previous reviewer feedback that must be fixed:\n${feedback}\n` : ""}

Build rules:
- Make the smallest code change that satisfies the plan.
- Do not commit changes.
- Do not rewrite unrelated architecture.
- Do not add vanity features.
- Preserve existing behavior unless the task explicitly requires changing it.
- Keep the implementation easy for a reviewer to verify.
- When done, stop.`
}

function reviewPrompt(input: {
  task: string
  plan: string
  attempt: number
  diff: string
  diffTruncated: boolean
  verification: { ok: boolean; output: string }
}) {
  return `You are the Plan Agent acting as a strict code reviewer.

Original task:
${input.task}

Implementation plan:
${input.plan}

Attempt:
${input.attempt}

Verification passed:
${input.verification.ok}

Verification output:
${input.verification.output}

Workspace diff:
${input.diff}

Diff truncated:
${input.diffTruncated}

Review rules:
- Approve only if the diff satisfies the task and plan.
- Reject if verification failed.
- Reject if the change is too broad, unrelated, unsafe, or lacks a clear acceptance path.
- Reject if there is no meaningful diff.
- Do not ask questions.
- Return ONLY valid JSON with this exact shape:
{
  "approved": boolean,
  "feedback": "string",
  "required_changes": ["string"],
  "risk_level": "low" | "medium" | "high"
}`
}

async function main() {
  const { opts, task } = parseArgs(process.argv.slice(2))
  const cwd = resolveWorkspace(opts.dir)

  if (!existsSync(cwd)) {
    throw new Error(`Workspace directory does not exist: ${cwd}`)
  }

  await requireCleanWorkspace(cwd, opts.allowDirty)

  console.log("Critic Loop: planning")
  const plan = await runOpenCode("plan", planPrompt(task), opts, cwd)
  console.log(plan)
  console.log("")

  let feedback: string | undefined

  for (let attempt = 1; attempt <= opts.attempts; attempt++) {
    console.log(`Critic Loop: build attempt ${attempt}/${opts.attempts}`)
    await runOpenCode("build", buildPrompt(task, plan, attempt, feedback), opts, cwd)

    const diff = await getWorkspaceDiff(cwd, opts.diffMaxChars)
    const hasMeaningfulDiff = !diff.text.includes("## git status --short\n(clean)")

    if (!hasMeaningfulDiff) {
      feedback = "No meaningful workspace diff was produced. Implement the requested change or explain why no code change is possible."
      console.log(`Critic Loop: rejected attempt ${attempt}: ${feedback}`)
      continue
    }

    const verification = await runVerification(cwd, opts)
    const reviewerText = await runOpenCode(
      "plan",
      reviewPrompt({
        task,
        plan,
        attempt,
        diff: diff.text,
        diffTruncated: diff.truncated,
        verification,
      }),
      opts,
      cwd,
    )

    const review = parseReview(reviewerText)
    const approved = review.approved && verification.ok

    if (approved) {
      console.log("Critic Loop: approved")
      console.log(JSON.stringify(review, null, 2))
      process.exit(0)
    }

    feedback = [
      review.feedback,
      ...(review.required_changes?.length ? ["Required changes:", ...review.required_changes.map((item) => `- ${item}`)] : []),
      verification.ok ? "" : "Verification failed. Fix the command output shown in the review prompt.",
    ]
      .filter(Boolean)
      .join("\n")

    console.log(`Critic Loop: rejected attempt ${attempt}`)
    console.log(feedback)
    console.log("")
  }

  console.error(`Critic Loop: failed after ${opts.attempts} attempt(s).`)
  if (feedback) {
    console.error(feedback)
  }
  process.exit(1)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
