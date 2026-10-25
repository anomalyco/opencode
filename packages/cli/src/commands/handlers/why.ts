import { Effect } from "effect"
import { UI } from "../ui"
import { effectCmd, fail } from "../effect-cmd"

const LIMIT = 80_000
const PATCHES = 5
const PATCHCAP = 6_000

const INSTRUCTIONS = [
  "You are a git archaeologist. Answer the question below about when and why a behavior changed, using only the commit evidence provided.",
  "Name the specific commits that changed the behavior, when they landed, and what the stated motivation was. Cite commits inline by their short sha, e.g. abc1234. If the evidence is not enough to answer confidently, say exactly what is missing instead of guessing.",
].join("\n")

export type Entry = {
  readonly sha: string
  readonly author: string
  readonly date: string
  readonly subject: string
}

/** Parse `git log --format=%H%x00%an%x00%ad%x00%s%x01` output into commit entries. */
export function entries(text: string) {
  return text
    .split("\x01")
    .map((chunk) => chunk.trim())
    .filter(Boolean)
    .map((chunk) => chunk.split("\x00"))
    .filter((parts) => parts.length === 4 && /^[0-9a-f]{40}$/.test(parts[0]))
    .map((parts) => ({ sha: parts[0], author: parts[1], date: parts[2], subject: parts[3] }) satisfies Entry)
}

/** Parse a --lines spec like "120" or "120,160" into a git -L range. */
export function span(spec: string) {
  const match = spec.match(/^(\d+)(?:,(\d+))?$/)
  if (!match) return undefined
  const start = Number(match[1])
  const end = match[2] === undefined ? start : Number(match[2])
  if (start < 1 || end < start) return undefined
  return { start, end }
}

/** Collect which of the evidence shas an answer actually cites. */
export function cited(text: string, shas: string[]) {
  return shas.filter((sha) => text.includes(sha.slice(0, 7)))
}

export const WhyCommand = effectCmd({
  command: "why <question>",
  describe: "answer when and why a behavior changed, with commit evidence",
  builder: (yargs) =>
    yargs
      .positional("question", {
        type: "string",
        demandOption: true,
        describe: 'the question, e.g. "when did retries stop being unlimited?"',
      })
      .option("file", {
        type: "string",
        describe: "narrow the search to one file's history",
      })
      .option("lines", {
        type: "string",
        describe: 'line range within --file, e.g. "120" or "120,160"',
      })
      .option("term", {
        type: "string",
        describe: "search history for commits that added or removed this string (git pickaxe)",
      })
      .option("model", {
        alias: "m",
        type: "string",
        describe: "model to use in the format of provider/model",
      }),
  handler: Effect.fn("Cli.why")(function* (args) {
    const { InstanceRef } = yield* Effect.promise(() => import("@/effect/instance-ref"))
    const { Git } = yield* Effect.promise(() => import("@/git"))
    const ctx = yield* InstanceRef
    if (!ctx) return yield* fail("Could not load instance context")
    if (ctx.project.vcs !== "git") {
      return yield* fail("Could not find git repository. Please run this command from a git repository.")
    }
    if (!args.file && !args.term) {
      return yield* fail("Point the dig somewhere: pass --file <path> and/or --term <string>.")
    }
    if (args.lines && !args.file) return yield* fail("--lines requires --file.")
    const git = yield* Git.Service
    const cwd = ctx.worktree
    const format = "--format=%H%x00%an%x00%ad%x00%s%x01"

    const log = yield* Effect.gen(function* () {
      if (args.lines) {
        const lines = span(args.lines)
        if (!lines) return yield* fail(`Could not parse --lines "${args.lines}". Use "120" or "120,160".`)
        // -L already prints patches; ask for the format header only and strip patches below.
        return yield* git.run(["log", format, "-s", `-L${lines.start},${lines.end}:${args.file}`], { cwd })
      }
      if (args.term) {
        const scope = args.file ? ["--", args.file] : []
        return yield* git.run(["log", format, "--pickaxe-regex", `-S${args.term}`, ...scope], { cwd })
      }
      return yield* git.run(["log", format, "--follow", "--", args.file ?? ""], { cwd })
    })
    if (log.exitCode !== 0) return yield* fail(log.stderr.toString().trim() || "git log failed")
    const found = entries(log.text())
    if (!found.length) {
      UI.println("No commits found for that file or term. Nothing to dig through.")
      return
    }

    UI.println(`Found ${found.length} relevant commits. Gathering evidence...`)
    const recent = found.slice(0, PATCHES)
    const patches = yield* Effect.forEach(recent, (entry) =>
      Effect.gen(function* () {
        const shown = yield* git.run(["show", "--format=commit %h%nauthor %an%ndate %ad%n%n%s%n%n%b", entry.sha], {
          cwd,
        })
        return shown.text().slice(0, PATCHCAP)
      }),
    )
    const older = found
      .slice(PATCHES)
      .map((entry) => `${entry.sha.slice(0, 7)} ${entry.date} ${entry.author}: ${entry.subject}`)
      .join("\n")
    const evidence = `${patches.join("\n---\n")}${older ? `\n---\nOlder commits (subjects only):\n${older}` : ""}`
    if (evidence.length > LIMIT) {
      return yield* fail("Too much history to analyze in one shot. Narrow the dig with --file or --lines.")
    }

    const { Session } = yield* Effect.promise(() => import("@/session/session"))
    const { SessionPrompt } = yield* Effect.promise(() => import("@/session/prompt"))
    const { MessageID, PartID } = yield* Effect.promise(() => import("../../session/schema"))
    const { parseModel } = yield* Effect.promise(() => import("@/provider/provider"))
    const { extractResponseText } = yield* Effect.promise(() => import("./github.shared"))
    const sessions = yield* Session.Service
    const prompt = yield* SessionPrompt.Service
    const session = yield* sessions.create({
      title: `bolt why: ${args.question}`,
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
            text: `${INSTRUCTIONS}\n\nQuestion: ${args.question}\n\nEvidence:\n${evidence}`,
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
    if (!text) return yield* fail("The model returned an empty answer.")

    UI.empty()
    UI.println(UI.markdown(text))
    UI.empty()

    const evidenced = cited(
      text,
      found.map((entry) => entry.sha),
    )
    if (!evidenced.length) {
      UI.println("Warning: the answer cites none of the commits in evidence. Treat it as a guess.")
      process.exitCode = 1
      return
    }
    UI.println(`Cited commits: ${evidenced.map((sha) => sha.slice(0, 7)).join(", ")}`)
  }),
})
