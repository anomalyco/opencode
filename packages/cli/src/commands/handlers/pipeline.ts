import type { PermissionV1 } from "@bolt-ai/core/v1/permission"
import { Effect } from "effect"
import { UI } from "../ui"
import { effectCmd, fail } from "../effect-cmd"
import { verdict } from "./review"

const LIMIT = 120_000

/** Decide what the pipeline does after a review stage completes. A missing verdict counts as a failure. */
export function decide(outcome: "pass" | "fail" | undefined, attempt: number, attempts: number) {
  if (outcome === "pass") return "pass" as const
  if (attempt >= attempts) return "stop" as const
  return "retry" as const
}

/** Extract the concrete defect list from a review response, dropping the verdict marker. */
export function defects(text: string) {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => /^(?:[-*]|\d+[.)])\s+/.test(line))
    .filter((line) => !/verdict:\s*(pass|fail)/i.test(line))
}

/** Reviewer feedback for the next code attempt: the defect list, or the full response minus the verdict line. */
export function feedback(review: string) {
  const items = defects(review)
  if (items.length > 0) return items.join("\n")
  return review
    .split("\n")
    .filter((line) => !/verdict:\s*(pass|fail)/i.test(line))
    .join("\n")
    .trim()
}

/** Stage banner printed at each pipeline transition. */
export function banner(stage: string, attempt: number, attempts: number) {
  const suffix = attempts > 1 ? ` (attempt ${attempt}/${attempts})` : ""
  return `── ${stage}${suffix} ──`
}

export function planPrompt(task: string) {
  return [
    "You are the planning stage of a three-stage pipeline (plan, code, review).",
    "Produce a numbered implementation plan for the task below. Use the read, grep, and glob tools to inspect the codebase first.",
    "Each step must name the files to touch and describe the change to make. Do not make any changes yourself.",
    "",
    `Task: ${task}`,
  ].join("\n")
}

export function codePrompt(task: string, plan: string, fixes?: string) {
  const parts = [
    "You are the coding stage of a three-stage pipeline (plan, code, review).",
    "Implement the plan below exactly. Make the edits and run any commands you need. Do not ask questions.",
    "",
    `Task: ${task}`,
    "",
    "Plan:",
    plan,
  ]
  if (fixes) parts.push("", "A reviewer found these defects in the previous attempt. Fix all of them:", fixes)
  return parts.join("\n")
}

export function reviewPrompt(task: string, plan: string, diff: string) {
  return [
    "You are the review stage of a three-stage pipeline (plan, code, review).",
    "Review the diff below against the task and plan. Use the read, grep, and glob tools to inspect surrounding code when the diff alone is not enough.",
    "List each concrete defect as a bullet with the file, line, and a short explanation. Do not restate the diff.",
    'End your final message with exactly one line: "Verdict: PASS" if the implementation is correct and complete, otherwise "Verdict: FAIL".',
    "",
    `Task: ${task}`,
    "",
    "Plan:",
    plan,
    "",
    "Diff:",
    diff,
  ].join("\n")
}

const HEADLESS: PermissionV1.Ruleset = [
  { permission: "question", action: "deny", pattern: "*" },
  { permission: "plan_enter", action: "deny", pattern: "*" },
  { permission: "plan_exit", action: "deny", pattern: "*" },
]

// The code stage additionally auto-approves edit and bash so it never blocks on a permission ask.
const CODE: PermissionV1.Ruleset = [
  ...HEADLESS,
  { permission: "edit", action: "allow", pattern: "*" },
  { permission: "bash", action: "allow", pattern: "*" },
]

export const PipelineCommand = effectCmd({
  command: "pipeline <task>",
  describe: "run a plan, code, review agent pipeline on a task",
  builder: (yargs) =>
    yargs
      .positional("task", {
        type: "string",
        demandOption: true,
        describe: "task to plan, implement, and review",
      })
      .option("attempts", {
        type: "number",
        default: 2,
        describe: "maximum code attempts before giving up",
      })
      .option("model", {
        alias: "m",
        type: "string",
        describe: "model to use in the format of provider/model",
      }),
  handler: Effect.fn("Cli.pipeline")(function* (args) {
    if (!Number.isInteger(args.attempts) || args.attempts < 1) {
      return yield* fail("--attempts must be a positive integer")
    }
    const { InstanceRef } = yield* Effect.promise(() => import("@/effect/instance-ref"))
    const { Git } = yield* Effect.promise(() => import("@/git"))
    const ctx = yield* InstanceRef
    if (!ctx) return yield* fail("Could not load instance context")
    if (ctx.project.vcs !== "git") {
      return yield* fail("Could not find git repository. Please run this command from a git repository.")
    }

    const git = yield* Git.Service
    const cwd = ctx.worktree
    const head = yield* git.run(["rev-parse", "HEAD"], { cwd })
    if (head.exitCode !== 0) return yield* fail(head.stderr.toString().trim() || "git rev-parse HEAD failed")
    const base = head.text().trim()

    const { Session } = yield* Effect.promise(() => import("@/session/session"))
    const { SessionPrompt } = yield* Effect.promise(() => import("@/session/prompt"))
    const { MessageID, PartID } = yield* Effect.promise(() => import("../../session/schema"))
    const { parseModel } = yield* Effect.promise(() => import("@/provider/provider"))
    const { extractResponseText } = yield* Effect.promise(() => import("./github.shared"))
    const sessions = yield* Session.Service
    const prompt = yield* SessionPrompt.Service
    const model = args.model ? parseModel(args.model) : undefined

    const stage = Effect.fnUntraced(function* (input: {
      agent: string
      title: string
      text: string
      permission: PermissionV1.Ruleset
    }) {
      const session = yield* sessions.create({ title: input.title, permission: [...input.permission] })
      const result = yield* prompt
        .prompt({
          sessionID: session.id,
          messageID: MessageID.ascending(),
          agent: input.agent,
          model,
          parts: [{ id: PartID.ascending(), type: "text", text: input.text }],
        })
        .pipe(Effect.orDie)
      if (result.info.role === "assistant" && result.info.error) {
        const err = result.info.error
        const message = "message" in err.data ? err.data.message : ""
        return yield* fail(`${err.name}: ${message}`)
      }
      const text = extractResponseText(result.parts) ?? ""
      if (!text) return yield* fail(`The ${input.agent} stage returned an empty response.`)
      return text
    })

    UI.println(banner("plan", 1, 1))
    const plan = yield* stage({
      agent: "plan",
      title: "bolt pipeline plan",
      text: planPrompt(args.task),
      permission: HEADLESS,
    })
    UI.empty()
    UI.println(UI.markdown(plan))
    UI.empty()

    let fixes: string | undefined
    for (let attempt = 1; attempt <= args.attempts; attempt++) {
      UI.println(banner("code", attempt, args.attempts))
      yield* stage({
        agent: "build",
        title: `bolt pipeline code ${attempt}`,
        text: codePrompt(args.task, plan, fixes),
        permission: CODE,
      })

      const diff = yield* git.run(["diff", base], { cwd })
      if (diff.exitCode !== 0) return yield* fail(diff.stderr.toString().trim() || "git diff failed")
      const patch = diff.text().trim()
      if (!patch) return yield* fail("The code stage made no changes to tracked files.")
      if (patch.length > LIMIT) {
        return yield* fail("The working tree diff is too large to review in one shot.")
      }

      UI.println(banner("review", attempt, args.attempts))
      const review = yield* stage({
        agent: "code-review",
        title: `bolt pipeline review ${attempt}`,
        text: reviewPrompt(args.task, plan, patch),
        permission: HEADLESS,
      })
      UI.empty()
      UI.println(UI.markdown(review))
      UI.empty()

      const next = decide(verdict(review), attempt, args.attempts)
      if (next === "pass") {
        UI.println("Pipeline passed review.")
        return
      }
      if (next === "stop") {
        UI.println(`Pipeline failed review after ${attempt} attempt${attempt > 1 ? "s" : ""}.`)
        process.exitCode = 1
        return
      }
      fixes = feedback(review)
      UI.println("Review failed. Retrying the code stage with the defect list.")
    }
  }),
})
