import { Effect } from "effect"
import { UI } from "../ui"
import { effectCmd, fail } from "../effect-cmd"

const LIMIT = 80_000
const FILECAP = 6_000

const INSTRUCTIONS = [
  "You are splitting a messy worktree into logical commits: one coherent change per commit.",
  "Group the changed files below so that each group is a single logical change that would make sense as one commit. Order the groups so earlier commits do not depend on later ones. Every file must appear in exactly one group.",
  "Output the plan as a fenced code block. Each group starts with a line `commit: <message>` using this repo's commit message conventions, followed by one `- <file>` line per file.",
].join("\n")

export type Change = {
  readonly file: string
  readonly code: string
}

export type Group = {
  readonly message: string
  readonly files: string[]
}

/** Parse changed paths out of `git status --porcelain=v1`, skipping unmerged entries. */
export function changes(text: string) {
  const skip = ["DD", "AU", "UD", "UA", "DU", "AA", "UU"]
  return text
    .split("\n")
    .filter((line) => line.length > 3)
    .filter((line) => !skip.includes(line.slice(0, 2)))
    .map((line) => {
      const code = line.slice(0, 2)
      const rest = line.slice(3).trim()
      const arrow = rest.indexOf(" -> ")
      return { file: arrow === -1 ? rest : rest.slice(arrow + 4), code } satisfies Change
    })
    .filter((change) => Boolean(change.file))
}

/** Parse commit groups out of the last fenced code block of an agent response. */
export function groups(text: string) {
  const blocks = [...text.matchAll(/```[^\n]*\n([\s\S]*?)```/g)]
  const last = blocks.at(-1)
  if (!last) return undefined
  const found: Group[] = []
  for (const line of last[1].split("\n")) {
    const trimmed = line.trim()
    if (!trimmed) continue
    if (trimmed.toLowerCase().startsWith("commit:")) {
      const message = trimmed.slice(7).trim()
      if (!message) return undefined
      found.push({ message, files: [] })
      continue
    }
    if (trimmed.startsWith("- ")) {
      const current = found.at(-1)
      if (!current) return undefined
      const file = trimmed.slice(2).trim()
      if (!file) return undefined
      current.files.push(file)
      continue
    }
    return undefined
  }
  if (!found.length) return undefined
  if (found.some((group) => !group.files.length)) return undefined
  return found
}

/** Validate that a plan covers every changed file exactly once. Returns an error message or undefined. */
export function cover(plan: Group[], files: string[]) {
  const listed = plan.flatMap((group) => group.files)
  const missing = files.filter((file) => !listed.includes(file))
  if (missing.length) return `plan is missing files: ${missing.join(", ")}`
  const unknown = listed.filter((file) => !files.includes(file))
  if (unknown.length) return `plan references unknown files: ${unknown.join(", ")}`
  const dupes = listed.filter((file, at) => listed.indexOf(file) !== at)
  if (dupes.length) return `plan lists files more than once: ${dupes.join(", ")}`
  return undefined
}

export const SplitCommand = effectCmd({
  command: "split",
  describe: "split a messy worktree into logical commits with the agent",
  builder: (yargs) =>
    yargs
      .option("apply", {
        type: "boolean",
        default: false,
        describe: "create the planned commits (never pushes)",
      })
      .option("model", {
        alias: "m",
        type: "string",
        describe: "model to use in the format of provider/model",
      }),
  handler: Effect.fn("Cli.split")(function* (args) {
    const { InstanceRef } = yield* Effect.promise(() => import("@/effect/instance-ref"))
    const { Git } = yield* Effect.promise(() => import("@/git"))
    const ctx = yield* InstanceRef
    if (!ctx) return yield* fail("Could not load instance context")
    if (ctx.project.vcs !== "git") {
      return yield* fail("Could not find git repository. Please run this command from a git repository.")
    }
    const git = yield* Git.Service
    const cwd = ctx.worktree

    const status = yield* git.run(["status", "--porcelain=v1"], { cwd })
    if (status.exitCode !== 0) return yield* fail(status.stderr.toString().trim() || "git status failed")
    const changed = changes(status.text())
    if (!changed.length) {
      UI.println("The worktree is clean. Nothing to split.")
      return
    }
    if (changed.length === 1) {
      UI.println("Only one file changed. Nothing to split; use bolt commit instead.")
      return
    }

    const patches = yield* Effect.forEach(changed, (change) =>
      Effect.gen(function* () {
        if (change.code === "??") {
          const content = yield* Effect.promise(() =>
            Bun.file(`${cwd}/${change.file}`)
              .text()
              .catch(() => ""),
          )
          return `new file ${change.file}:\n${content.slice(0, FILECAP)}`
        }
        const diff = yield* git.run(["diff", "HEAD", "--", change.file], { cwd })
        return `${change.file}:\n${diff.text().slice(0, FILECAP)}`
      }),
    )
    const listing = patches.join("\n---\n")
    if (listing.length > LIMIT) {
      return yield* fail("The worktree diff is too large to split in one shot. Commit some of it first.")
    }

    UI.println(`Planning commits for ${changed.length} changed files...`)
    const { Session } = yield* Effect.promise(() => import("@/session/session"))
    const { SessionPrompt } = yield* Effect.promise(() => import("@/session/prompt"))
    const { MessageID, PartID } = yield* Effect.promise(() => import("../../session/schema"))
    const { parseModel } = yield* Effect.promise(() => import("@/provider/provider"))
    const { extractResponseText } = yield* Effect.promise(() => import("./github.shared"))
    const sessions = yield* Session.Service
    const prompt = yield* SessionPrompt.Service
    const session = yield* sessions.create({
      title: "bolt split",
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
            text: `${INSTRUCTIONS}\n\nChanged files with diffs:\n${listing}`,
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
    const plan = groups(text)
    if (!plan) return yield* fail("The model did not return a parseable commit plan.")
    const invalid = cover(
      plan,
      changed.map((change) => change.file),
    )
    if (invalid) return yield* fail(`The model returned an invalid plan: ${invalid}`)

    UI.empty()
    UI.println("Commit plan:")
    for (const group of plan) {
      UI.println(`  ${group.message}`)
      for (const file of group.files) UI.println(`    - ${file}`)
    }
    UI.empty()

    if (!args.apply) {
      UI.println("Dry run. Rerun with --apply to create these commits. Nothing is ever pushed.")
      return
    }

    yield* git.run(["reset"], { cwd })
    yield* Effect.forEach(plan, (group) =>
      Effect.gen(function* () {
        const added = yield* git.run(["add", "-A", "--", ...group.files], { cwd })
        if (added.exitCode !== 0) {
          return yield* fail(`Failed to stage ${group.files.join(", ")}: ${added.stderr.toString().trim()}`)
        }
        const committed = yield* git.run(["commit", "-m", group.message], { cwd })
        if (committed.exitCode !== 0) {
          return yield* fail(`Failed to commit "${group.message}": ${committed.stderr.toString().trim()}`)
        }
        UI.println(`Committed: ${group.message}`)
      }),
    )
    UI.println("All commits created. Nothing was pushed.")
  }),
})
