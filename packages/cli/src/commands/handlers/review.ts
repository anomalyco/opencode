import { Effect } from "effect"
import { UI } from "../ui"
import { Envelope } from "../envelope"
import { ExitCode } from "../exit"
import { Porcelain } from "../porcelain"
import { effectCmd, fail } from "../effect-cmd"

const LIMIT = 120_000

/** Parse the last pass/fail verdict marker from the review response. */
export function verdict(text: string) {
  const matches = [...text.matchAll(/verdict:\s*(pass|fail)/gi)]
  const last = matches.at(-1)
  if (!last) return undefined
  return last[1].toLowerCase() as "pass" | "fail"
}

/** Parse the last confidence marker from an agent response. */
export function confidence(text: string) {
  const matches = [...text.matchAll(/confidence:\s*(high|medium|low)/gi)]
  const last = matches.at(-1)
  if (!last) return undefined
  return last[1].toLowerCase() as "high" | "medium" | "low"
}

export const CONFIDENCE =
  'End your final message with exactly one line: "Confidence: high", "Confidence: medium", or "Confidence: low". Use "low" when you are mostly guessing.'

export const INSTRUCTIONS = [
  "Review the following code changes. Use the read, grep, and glob tools to inspect surrounding code when the diff alone is not enough.",
  "Report each issue with a severity (critical, major, minor), the file and line, and a short explanation. Be concise and do not restate the diff. If there are no issues, say so.",
  'End your final message with exactly one line: "Verdict: PASS" if there are no critical or major issues, otherwise "Verdict: FAIL".',
].join("\n")

export const ReviewCommand = effectCmd({
  command: "review",
  describe: "review code changes with the code-review agent",
  builder: (yargs) =>
    yargs
      .option("staged", {
        type: "boolean",
        describe: "review staged changes only",
        default: false,
      })
      .option("branch", {
        type: "string",
        describe: "review changes since the merge base with a branch (defaults to the default branch)",
      })
      .option("model", {
        alias: "m",
        type: "string",
        describe: "model to use in the format of provider/model",
      })
      .option("confidence", {
        type: "boolean",
        describe: "ask the model to report how confident it is in the review",
        default: false,
      })
      .option("json", {
        type: "boolean",
        describe: Envelope.DESCRIBE,
        default: false,
      })
      .option("porcelain", {
        type: "boolean",
        describe: Porcelain.DESCRIBE,
        default: false,
      })
      .conflicts("porcelain", "json")
      .conflicts("staged", "branch")
      .epilogue(
        `exit codes: ${ExitCode.OK} pass, ${ExitCode.VERDICT} fail verdict, ${ExitCode.UNKNOWN} no verdict determined`,
      ),
  handler: Effect.fn("Cli.review")(function* (args) {
    const { InstanceRef } = yield* Effect.promise(() => import("@/effect/instance-ref"))
    const { Git } = yield* Effect.promise(() => import("@/git"))
    const { Stdin } = yield* Effect.promise(() => import("../stdin"))
    const piped = yield* Effect.promise(() => Stdin.piped())
    if (piped && args.staged) return yield* fail("--staged cannot be used with a diff piped on stdin")
    if (piped && args.branch !== undefined) return yield* fail("--branch cannot be used with a diff piped on stdin")

    const ctx = yield* InstanceRef
    if (!ctx) return yield* fail("Could not load instance context")
    const git = yield* Git.Service
    const cwd = ctx.worktree

    const patch = yield* Effect.gen(function* () {
      if (piped) return piped.trim()
      if (ctx.project.vcs !== "git") {
        return yield* fail("Could not find git repository. Run from a git repository or pipe a diff on stdin.")
      }

      const range = yield* Effect.gen(function* () {
        if (args.staged) return ["diff", "--cached"]
        if (args.branch === undefined) return ["diff", "HEAD"]
        const base = yield* Effect.gen(function* () {
          if (args.branch) return args.branch
          const branch = yield* git.defaultBranch(cwd)
          if (!branch) return yield* fail("Could not determine the default branch. Pass one with --branch <name>.")
          return branch.ref
        })
        const merge = yield* git.mergeBase(cwd, base)
        if (!merge) return yield* fail(`Could not find a merge base with ${base}.`)
        return ["diff", `${merge}..HEAD`]
      })

      const diff = yield* git.run(range, { cwd })
      if (diff.exitCode !== 0) return yield* fail(diff.stderr.toString().trim() || "git diff failed")
      const text = diff.text().trim()

      const span = range.length === 2 && range[1].includes("..") && text && !args.json ? range[1] : undefined
      if (span) {
        const { Signature } = yield* Effect.promise(() => import("./signature"))
        const signed = yield* git.run(["log", "--format=%h%x00%G?%x00%GS", span], { cwd })
        if (signed.exitCode === 0) {
          for (const item of Signature.summary(Signature.parse(signed.text()))) UI.println(item)
        }
      }

      return text
    })

    if (!patch) {
      if (args.json) {
        Envelope.print({ verdict: null, confidence: null, text: "" })
        return
      }
      if (args.porcelain) {
        Porcelain.print("verdict", "pass")
        return
      }
      UI.println("Nothing to review.")
      return
    }
    if (patch.length > LIMIT) {
      return yield* fail("The diff is too large to review in one shot. Review a narrower range.")
    }

    if (!args.json && !args.porcelain) UI.println("Reviewing changes...")

    const { Session } = yield* Effect.promise(() => import("@/session/session"))
    const { SessionPrompt } = yield* Effect.promise(() => import("@/session/prompt"))
    const { MessageID, PartID } = yield* Effect.promise(() => import("../../session/schema"))
    const { parseModel } = yield* Effect.promise(() => import("@/provider/provider"))
    const { extractResponseText } = yield* Effect.promise(() => import("./github.shared"))
    const sessions = yield* Session.Service
    const prompt = yield* SessionPrompt.Service
    const session = yield* sessions.create({
      title: "bolt review",
      permission: [{ permission: "question", action: "deny", pattern: "*" }],
    })

    const result = yield* prompt
      .prompt({
        sessionID: session.id,
        messageID: MessageID.ascending(),
        agent: "code-review",
        model: args.model ? parseModel(args.model) : undefined,
        parts: [
          {
            id: PartID.ascending(),
            type: "text",
            text: `${INSTRUCTIONS}${args.confidence ? `\n${CONFIDENCE}` : ""}\n\nDiff:\n${patch}`,
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
    if (!text) return yield* fail("The model returned an empty review.")

    const outcome = verdict(text)
    if (args.json) {
      Envelope.print({
        verdict: outcome ?? null,
        confidence: args.confidence ? (confidence(text) ?? null) : null,
        text,
      })
      if (outcome === "fail") process.exitCode = ExitCode.VERDICT
      if (!outcome) process.exitCode = ExitCode.UNKNOWN
      return
    }
    if (args.porcelain) {
      Porcelain.print("verdict", outcome ?? "unknown")
      if (args.confidence) Porcelain.print("confidence", confidence(text) ?? "unknown")
      Porcelain.print("text", text)
      if (outcome === "fail") process.exitCode = ExitCode.VERDICT
      if (!outcome) process.exitCode = ExitCode.UNKNOWN
      return
    }

    UI.empty()
    UI.println(UI.markdown(text))
    UI.empty()

    if (args.confidence) {
      const level = confidence(text)
      UI.println(
        level ? `Confidence: ${level.toUpperCase()}` : "Could not determine a confidence level from the review.",
      )
      UI.empty()
    }

    if (outcome === "pass") return
    if (outcome === "fail") {
      process.exitCode = ExitCode.VERDICT
      return
    }
    UI.println("Could not determine a verdict from the review.")
    process.exitCode = ExitCode.UNKNOWN
  }),
})
