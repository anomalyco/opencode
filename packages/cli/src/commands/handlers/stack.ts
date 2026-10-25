import { Effect } from "effect"
import { UI } from "../ui"
import { effectCmd, fail } from "../effect-cmd"

const LIMIT = 60_000

const INSTRUCTIONS = [
  "You are splitting one big branch into an ordered, reviewable stack of pull requests.",
  "The commits below are listed oldest first. Partition them into contiguous groups, keeping the original order, so that each group is one reviewable unit that builds on the groups before it. Do not reorder commits across groups.",
  "Output the plan as a fenced code block. Each group starts with a line `branch: <name> :: <pr title>` where the name is a short lowercase hyphenated branch name, followed by one `- <sha>` line per commit in order.",
].join("\n")

export type Layer = {
  readonly name: string
  readonly title: string
  readonly shas: string[]
}

/** Parse stack layers out of the last fenced code block of an agent response. */
export function layers(text: string) {
  const blocks = [...text.matchAll(/```[^\n]*\n([\s\S]*?)```/g)]
  const last = blocks.at(-1)
  if (!last) return undefined
  const found: Layer[] = []
  for (const line of last[1].split("\n")) {
    const trimmed = line.trim()
    if (!trimmed) continue
    const head = trimmed.match(/^branch:\s*([a-z0-9][a-z0-9-]*)\s*::\s*(.+)$/)
    if (head) {
      found.push({ name: head[1], title: head[2].trim(), shas: [] })
      continue
    }
    const sha = trimmed.match(/^-\s*([0-9a-f]{7,40})$/)
    if (sha) {
      const current = found.at(-1)
      if (!current) return undefined
      current.shas.push(sha[1])
      continue
    }
    return undefined
  }
  if (!found.length) return undefined
  if (found.some((layer) => !layer.shas.length)) return undefined
  return found
}

/** Validate that layers form a contiguous, ordered partition of the branch commits. Returns an error or undefined. */
export function contiguous(plan: Layer[], shas: string[]) {
  const short = (sha: string) => sha.slice(0, 7)
  const wanted = shas.map(short)
  const got = plan.flatMap((layer) => layer.shas.map(short))
  if (got.length !== wanted.length || got.some((sha, at) => sha !== wanted[at])) {
    return `plan must list every commit exactly once, oldest first; expected ${wanted.join(", ")} and got ${got.join(", ")}`
  }
  const names = plan.map((layer) => layer.name)
  const dupes = names.filter((name, at) => names.indexOf(name) !== at)
  if (dupes.length) return `plan reuses branch names: ${dupes.join(", ")}`
  return undefined
}

/** Render the `gh pr create` commands for a stack, each based on the branch below it. */
export function commands(plan: Layer[], base: string) {
  return plan.map((layer, at) => {
    const target = at === 0 ? base : plan[at - 1].name
    return `gh pr create --head ${layer.name} --base ${target} --title ${JSON.stringify(layer.title)}`
  })
}

export const StackCommand = effectCmd({
  command: "stack",
  describe: "split the current branch into an ordered stack of reviewable branches",
  builder: (yargs) =>
    yargs
      .option("base", {
        type: "string",
        describe: "base ref for the stack (defaults to the default branch)",
      })
      .option("apply", {
        type: "boolean",
        default: false,
        describe: "create the stack branches locally",
      })
      .option("push", {
        type: "boolean",
        default: false,
        describe: "push the created branches to origin (implies --apply; plain push, never force)",
      })
      .option("model", {
        alias: "m",
        type: "string",
        describe: "model to use in the format of provider/model",
      }),
  handler: Effect.fn("Cli.stack")(function* (args) {
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
      if (args.base) return args.base
      const branch = yield* git.defaultBranch(cwd)
      if (!branch) return yield* fail("Could not determine the default branch. Pass one with --base <ref>.")
      return branch.ref
    })
    const merge = yield* git.mergeBase(cwd, base)
    if (!merge) return yield* fail(`Could not find a merge base with ${base}.`)

    const log = yield* git.run(["log", "--reverse", "--format=%H%x00%s", `${merge}..HEAD`], { cwd })
    if (log.exitCode !== 0) return yield* fail(log.stderr.toString().trim() || "git log failed")
    const commits = log
      .text()
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => line.split("\x00"))
      .map((parts) => ({ sha: parts[0], subject: parts[1] ?? "" }))
    if (commits.length < 2) {
      UI.println(`Need at least two commits ahead of ${base} to build a stack.`)
      return
    }

    const stats = yield* Effect.forEach(commits, (commit) =>
      Effect.gen(function* () {
        const stat = yield* git.run(["show", "--stat", "--format=", commit.sha], { cwd })
        return `${commit.sha.slice(0, 7)} ${commit.subject}\n${stat.text().trim()}`
      }),
    )
    const listing = stats.join("\n---\n")
    if (listing.length > LIMIT) return yield* fail("Too many commits to plan in one shot. Stack a narrower range.")

    UI.println(`Planning a stack for ${commits.length} commits on top of ${base}...`)
    const { Session } = yield* Effect.promise(() => import("@/session/session"))
    const { SessionPrompt } = yield* Effect.promise(() => import("@/session/prompt"))
    const { MessageID, PartID } = yield* Effect.promise(() => import("../../session/schema"))
    const { parseModel } = yield* Effect.promise(() => import("@/provider/provider"))
    const { extractResponseText } = yield* Effect.promise(() => import("./github.shared"))
    const sessions = yield* Session.Service
    const prompt = yield* SessionPrompt.Service
    const session = yield* sessions.create({
      title: "bolt stack",
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
    const plan = layers(text)
    if (!plan) return yield* fail("The model did not return a parseable stack plan.")
    const invalid = contiguous(
      plan,
      commits.map((commit) => commit.sha),
    )
    if (invalid) return yield* fail(`The model returned an invalid plan: ${invalid}`)

    UI.empty()
    UI.println("Stack plan:")
    for (const layer of plan) {
      UI.println(`  ${layer.name}: ${layer.title}`)
      for (const sha of layer.shas) {
        const subject = commits.find((commit) => commit.sha.startsWith(sha.slice(0, 7)))?.subject ?? ""
        UI.println(`    - ${sha.slice(0, 7)} ${subject}`)
      }
    }
    UI.empty()

    if (!args.apply && !args.push) {
      UI.println("Dry run. Rerun with --apply to create the branches, plus --push to push them.")
      return
    }

    for (const layer of plan) {
      const exists = yield* git.run(["show-ref", "--verify", "--quiet", `refs/heads/${layer.name}`], { cwd })
      if (exists.exitCode === 0) return yield* fail(`Branch ${layer.name} already exists. Not touching it.`)
    }

    yield* Effect.forEach(plan, (layer) =>
      Effect.gen(function* () {
        const tip = layer.shas.at(-1)
        const full = commits.find((commit) => commit.sha.startsWith((tip ?? "").slice(0, 7)))?.sha
        if (!full) return yield* fail(`Could not resolve ${tip} to a full sha.`)
        const created = yield* git.run(["branch", layer.name, full], { cwd })
        if (created.exitCode !== 0) {
          return yield* fail(`Failed to create ${layer.name}: ${created.stderr.toString().trim()}`)
        }
        UI.println(`Created ${layer.name} at ${full.slice(0, 7)}`)
        if (!args.push) return
        const pushed = yield* git.run(["push", "-u", "origin", layer.name], { cwd })
        if (pushed.exitCode !== 0) {
          return yield* fail(`Failed to push ${layer.name}: ${pushed.stderr.toString().trim()}`)
        }
        UI.println(`Pushed ${layer.name}`)
      }),
    )

    UI.empty()
    UI.println("Open the stack as pull requests, bottom first:")
    for (const command of commands(plan, base.replace(/^origin\//, ""))) UI.println(`  ${command}`)
  }),
})
