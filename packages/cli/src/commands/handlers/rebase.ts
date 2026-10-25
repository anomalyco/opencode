import { Effect } from "effect"
import { UI } from "../ui"
import { effectCmd, fail } from "../effect-cmd"

const LIMIT = 60_000

const ACTIONS = ["pick", "reword", "squash", "fixup", "drop"] as const

export type Action = (typeof ACTIONS)[number]

export type Step = {
  readonly action: Action
  readonly sha: string
  readonly subject?: string
  readonly note: string
}

const INSTRUCTIONS = [
  "You are planning an interactive git rebase. The commits below are listed oldest first.",
  "Decide, for each commit, whether to pick, reword, squash, fixup, or drop it. Squash fixup-style commits into the change they amend, drop dead experiments, and reword vague subjects. Keep the plan conservative: when in doubt, pick.",
  'Output the plan as a fenced code block. One line per commit, oldest first, in the form `<action> <sha> :: <explanation>`. For reword, include the new subject in double quotes: `reword <sha> "new subject" :: <explanation>`. Every input commit must appear exactly once, and the first non-drop line must be pick or reword.',
].join("\n")

/** Parse the rebase plan out of the last fenced code block of an agent response. */
export function plan(text: string) {
  const blocks = [...text.matchAll(/```[^\n]*\n([\s\S]*?)```/g)]
  const last = blocks.at(-1)
  if (!last) return undefined
  const steps: Step[] = []
  for (const line of last[1].split("\n")) {
    const trimmed = line.trim()
    if (!trimmed) continue
    const match = trimmed.match(
      /^(pick|reword|squash|fixup|drop)\s+([0-9a-f]{7,40})(?:\s+"((?:[^"\\]|\\.)*)")?\s*::\s*(.*)$/,
    )
    if (!match) return undefined
    steps.push({
      action: match[1] as Action,
      sha: match[2],
      ...(match[3] === undefined ? {} : { subject: match[3].replace(/\\(.)/g, "$1") }),
      note: match[4].trim(),
    })
  }
  if (!steps.length) return undefined
  return steps
}

/** Validate a plan against the commits being rebased. Returns an error message or undefined. */
export function check(steps: Step[], shas: string[]) {
  const short = (sha: string) => sha.slice(0, 7)
  const wanted = shas.map(short)
  const got = steps.map((step) => short(step.sha))
  const missing = wanted.filter((sha) => !got.includes(sha))
  if (missing.length) return `plan is missing commits: ${missing.join(", ")}`
  const unknown = got.filter((sha) => !wanted.includes(sha))
  if (unknown.length) return `plan references unknown commits: ${unknown.join(", ")}`
  const dupes = got.filter((sha, at) => got.indexOf(sha) !== at)
  if (dupes.length) return `plan lists commits more than once: ${dupes.join(", ")}`
  const first = steps.find((step) => step.action !== "drop")
  if (first && (first.action === "squash" || first.action === "fixup")) {
    return `the first kept commit cannot be a ${first.action}`
  }
  const reworded = steps.find((step) => step.action === "reword" && !step.subject?.trim())
  if (reworded) return `reword for ${short(reworded.sha)} is missing a new subject`
  return undefined
}

/** Serialize a validated plan into a git rebase todo file. Rewords become pick + exec amend so no editor is needed. */
export function todo(steps: Step[]) {
  return steps
    .flatMap((step) => {
      if (step.action === "reword") {
        const subject = (step.subject ?? "").replace(/\\/g, "\\\\").replace(/"/g, '\\"')
        return [`pick ${step.sha}`, `exec git commit --amend -m "${subject}"`]
      }
      return [`${step.action} ${step.sha}`]
    })
    .join("\n")
    .concat("\n")
}

export const RebaseCommand = effectCmd({
  command: "rebase",
  describe: "plan an interactive rebase with the agent and explain every decision",
  builder: (yargs) =>
    yargs
      .option("onto", {
        type: "string",
        describe: "base ref to rebase onto (defaults to the merge base with the default branch)",
      })
      .option("apply", {
        type: "boolean",
        default: false,
        describe: "execute the plan (rewrites local history; never pushes)",
      })
      .option("model", {
        alias: "m",
        type: "string",
        describe: "model to use in the format of provider/model",
      }),
  handler: Effect.fn("Cli.rebase")(function* (args) {
    const { InstanceRef } = yield* Effect.promise(() => import("@/effect/instance-ref"))
    const { Git } = yield* Effect.promise(() => import("@/git"))
    const ctx = yield* InstanceRef
    if (!ctx) return yield* fail("Could not load instance context")
    if (ctx.project.vcs !== "git") {
      return yield* fail("Could not find git repository. Please run this command from a git repository.")
    }
    const git = yield* Git.Service
    const cwd = ctx.worktree

    const base = yield* Effect.gen(function* () {
      if (args.onto) return args.onto
      const branch = yield* git.defaultBranch(cwd)
      if (!branch) return yield* fail("Could not determine the default branch. Pass one with --onto <ref>.")
      return branch.ref
    })
    const merge = yield* git.mergeBase(cwd, base)
    if (!merge) return yield* fail(`Could not find a merge base with ${base}.`)

    const log = yield* git.run(["log", "--reverse", "--format=%H%x00%s%x00%b%x01", `${merge}..HEAD`], { cwd })
    if (log.exitCode !== 0) return yield* fail(log.stderr.toString().trim() || "git log failed")
    const commits = log
      .text()
      .split("\x01")
      .map((chunk) => chunk.trim())
      .filter(Boolean)
      .map((chunk) => chunk.split("\x00"))
      .map((parts) => ({ sha: parts[0], subject: parts[1] ?? "", body: (parts[2] ?? "").trim() }))
    if (!commits.length) {
      UI.println(`Nothing to rebase: HEAD does not diverge from ${base}.`)
      return
    }
    if (commits.length === 1) {
      UI.println("Only one commit ahead of the base. Nothing worth rebasing.")
      return
    }

    const listing = commits
      .map((commit) => `${commit.sha.slice(0, 7)} ${commit.subject}${commit.body ? `\n${commit.body}` : ""}`)
      .join("\n---\n")
    if (listing.length > LIMIT) return yield* fail("Too many commits to plan in one shot. Rebase a narrower range.")

    UI.println(`Planning a rebase of ${commits.length} commits onto ${base}...`)
    const { Session } = yield* Effect.promise(() => import("@/session/session"))
    const { SessionPrompt } = yield* Effect.promise(() => import("@/session/prompt"))
    const { MessageID, PartID } = yield* Effect.promise(() => import("../../session/schema"))
    const { parseModel } = yield* Effect.promise(() => import("@/provider/provider"))
    const { extractResponseText } = yield* Effect.promise(() => import("./github.shared"))
    const sessions = yield* Session.Service
    const prompt = yield* SessionPrompt.Service
    const session = yield* sessions.create({
      title: "bolt rebase",
      permission: [
        { permission: "question", action: "deny", pattern: "*" },
        { permission: "plan_enter", action: "deny", pattern: "*" },
        { permission: "plan_exit", action: "deny", pattern: "*" },
      ],
    })

    const result = yield* prompt
      .prompt({
        sessionID: session.id,
        messageID: MessageID.ascending(),
        model: args.model ? parseModel(args.model) : undefined,
        parts: [
          {
            id: PartID.ascending(),
            type: "text",
            text: `${INSTRUCTIONS}\n\nCommits (oldest first):\n${listing}`,
          },
        ],
      })
      .pipe(Effect.orDie)

    if (result.info.role === "assistant" && result.info.error) {
      const err = result.info.error
      const message = "message" in err.data ? err.data.message : ""
      return yield* fail(`${err.name}: ${message}`)
    }

    const text = extractResponseText(result.parts) ?? ""
    const steps = plan(text)
    if (!steps) return yield* fail("The model did not return a parseable rebase plan.")
    const invalid = check(
      steps,
      commits.map((commit) => commit.sha),
    )
    if (invalid) return yield* fail(`The model returned an invalid plan: ${invalid}`)

    UI.empty()
    UI.println("Rebase plan:")
    for (const step of steps) {
      const subject = commits.find((commit) => commit.sha.startsWith(step.sha.slice(0, 7)))?.subject ?? ""
      UI.println(`  ${step.action.padEnd(6)} ${step.sha.slice(0, 7)} ${step.subject ?? subject}`)
      UI.println(`         ${step.note}`)
    }
    UI.empty()

    if (!args.apply) {
      UI.println("Dry run. Rerun with --apply to execute this plan. It rewrites local history and never pushes.")
      return
    }

    const status = yield* git.run(["status", "--porcelain=v1"], { cwd })
    if (status.exitCode !== 0) return yield* fail(status.stderr.toString().trim() || "git status failed")
    if (status.text().trim()) {
      return yield* fail("The worktree has uncommitted changes. Commit or stash them before rebasing.")
    }

    const { join } = yield* Effect.promise(() => import("node:path"))
    const { tmpdir } = yield* Effect.promise(() => import("node:os"))
    const file = join(tmpdir(), `bolt-rebase-${Date.now()}.todo`)
    yield* Effect.promise(() => Bun.write(file, todo(steps)))

    UI.println("Executing the plan...")
    const run = yield* git.run(["rebase", "-i", merge], {
      cwd,
      env: { GIT_SEQUENCE_EDITOR: `cp "${file}"`, GIT_EDITOR: "true" },
    })
    if (run.exitCode !== 0) {
      yield* git.run(["rebase", "--abort"], { cwd })
      return yield* fail(
        `${run.stderr.toString().trim() || "git rebase failed"}\nThe rebase was aborted; your branch is unchanged.`,
      )
    }

    const after = yield* git.run(["log", "--oneline", `${merge}..HEAD`], { cwd })
    UI.empty()
    UI.println("Rebase complete. New history:")
    UI.println(after.text().trim())
    UI.println("Nothing was pushed. Review the result before pushing.")
  }),
})
