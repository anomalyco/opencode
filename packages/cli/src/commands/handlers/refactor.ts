import { Effect } from "effect"
import { UI } from "../ui"
import { effectCmd, fail } from "../effect-cmd"

const LIMIT = 20_000

/** Keep the tail of test output so the most recent failures survive the cap. */
export function tail(output: string, limit = LIMIT) {
  const trimmed = output.trim()
  if (trimmed.length <= limit) return trimmed
  return `[output truncated]\n${trimmed.slice(-limit)}`
}

export const RefactorCommand = effectCmd({
  command: "refactor <instruction>",
  describe: "refactor with a test-verified loop: change, run, verify, repeat until green",
  builder: (yargs) =>
    yargs
      .positional("instruction", {
        describe: "refactor instruction for the agent",
        type: "string",
        demandOption: true,
      })
      .option("test", {
        type: "string",
        describe: "test command that must exit 0 for the refactor to count as done",
        demandOption: true,
      })
      .option("attempts", {
        type: "number",
        describe: "maximum number of test-and-fix iterations",
        default: 5,
      })
      .option("model", {
        alias: "m",
        type: "string",
        describe: "model to use in the format of provider/model",
      })
      .option("confidence", {
        type: "boolean",
        describe: "ask the model to report how confident it is in the refactor",
        default: false,
      })
      .option("self-review", {
        type: "boolean",
        describe: "review the resulting diff with the code-review agent once tests are green",
        default: false,
      }),
  handler: Effect.fn("Cli.refactor")(function* (args) {
    const { InstanceRef } = yield* Effect.promise(() => import("@/effect/instance-ref"))
    const ctx = yield* InstanceRef
    if (!ctx) return yield* fail("Could not load instance context")

    const attempts = Math.max(1, Math.floor(args.attempts))
    const { Session } = yield* Effect.promise(() => import("@/session/session"))
    const { SessionPrompt } = yield* Effect.promise(() => import("@/session/prompt"))
    const { MessageID, PartID } = yield* Effect.promise(() => import("../../session/schema"))
    const { parseModel } = yield* Effect.promise(() => import("@/provider/provider"))
    const { extractResponseText } = yield* Effect.promise(() => import("./github.shared"))
    const sessions = yield* Session.Service
    const prompt = yield* SessionPrompt.Service
    const session = yield* sessions.create({
      title: "bolt refactor",
      permission: [
        { permission: "question", action: "deny", pattern: "*" },
        { permission: "plan_enter", action: "deny", pattern: "*" },
        { permission: "plan_exit", action: "deny", pattern: "*" },
      ],
    })

    const { confidence, CONFIDENCE, INSTRUCTIONS, verdict } = yield* Effect.promise(() => import("./review"))
    const send = Effect.fn(function* (text: string) {
      const result = yield* prompt
        .prompt({
          sessionID: session.id,
          messageID: MessageID.ascending(),
          model: args.model ? parseModel(args.model) : undefined,
          parts: [{ id: PartID.ascending(), type: "text", text: args.confidence ? `${text}\n\n${CONFIDENCE}` : text }],
        })
        .pipe(Effect.orDie)
      if (result.info.role === "assistant" && result.info.error) {
        const err = result.info.error
        const message = "message" in err.data ? err.data.message : ""
        return yield* fail(`${err.name}: ${message}`)
      }
      return extractResponseText(result.parts) ?? ""
    })

    // Run the test command through a shell so pipes, && chains, and quoting work as typed.
    const test = Effect.promise(async () => {
      const shell = process.platform === "win32" ? ["cmd", "/c", args.test] : ["sh", "-c", args.test]
      const proc = Bun.spawn(shell, { cwd: ctx.worktree, stdout: "pipe", stderr: "pipe" })
      const stdout = await new Response(proc.stdout).text()
      const stderr = await new Response(proc.stderr).text()
      const exit = await proc.exited
      return { exit, output: `${stdout}\n${stderr}` }
    })

    // Review the resulting worktree diff in a fresh code-review session. Warns
    // on a FAIL verdict but never reverts: tests are green at this point.
    const review = Effect.gen(function* () {
      if (ctx.project.vcs !== "git") {
        UI.println("Skipping self-review: not a git repository.")
        return
      }
      const { Git } = yield* Effect.promise(() => import("@/git"))
      const git = yield* Git.Service
      const diff = yield* git.run(["diff"], { cwd: ctx.worktree })
      if (diff.exitCode !== 0) {
        UI.println(`Skipping self-review: ${diff.stderr.toString().trim() || "git diff failed"}`)
        return
      }
      const patch = diff.text().trim()
      if (!patch) {
        UI.println("Nothing to self-review: git diff is empty.")
        return
      }
      // Mirrors the cap in `bolt review`; a larger diff cannot be reviewed in one shot.
      if (patch.length > 120_000) {
        UI.println("Skipping self-review: the diff is too large to review in one shot.")
        return
      }
      UI.println("Self-reviewing the diff...")
      const reviewer = yield* sessions.create({
        title: "bolt refactor self-review",
        permission: [{ permission: "question", action: "deny", pattern: "*" }],
      })
      const result = yield* prompt
        .prompt({
          sessionID: reviewer.id,
          messageID: MessageID.ascending(),
          agent: "code-review",
          model: args.model ? parseModel(args.model) : undefined,
          parts: [{ id: PartID.ascending(), type: "text", text: `${INSTRUCTIONS}\n\nDiff:\n${patch}` }],
        })
        .pipe(Effect.orDie)
      if (result.info.role === "assistant" && result.info.error) {
        const err = result.info.error
        const message = "message" in err.data ? err.data.message : ""
        UI.println(`Skipping self-review: ${err.name}: ${message}`)
        return
      }
      const text = extractResponseText(result.parts) ?? ""
      if (!text) {
        UI.println("The self-review returned an empty response.")
        return
      }
      UI.empty()
      UI.println(UI.markdown(text))
      UI.empty()
      const outcome = verdict(text)
      if (outcome === "pass") {
        UI.println("Self-review verdict: PASS")
        return
      }
      if (outcome === "fail") {
        UI.println("Warning: self-review verdict is FAIL. Changes were kept; review the diff before committing.")
        return
      }
      UI.println("Could not determine a verdict from the self-review.")
    })

    UI.println("Refactoring...")
    let latest = yield* send(args.instruction)

    for (let attempt = 1; attempt <= attempts; attempt++) {
      UI.println(`Running tests (attempt ${attempt}/${attempts}): ${args.test}`)
      const run = yield* test
      if (run.exit === 0) {
        UI.println("Tests are green. Refactor complete.")
        if (args.confidence) {
          const level = confidence(latest)
          UI.println(
            level ? `Confidence: ${level.toUpperCase()}` : "Could not determine a confidence level from the response.",
          )
        }
        if (args["self-review"]) yield* review
        return
      }
      if (attempt === attempts) break
      UI.println(`Tests failed with exit code ${run.exit}. Asking the agent to fix...`)
      latest = yield* send(
        [
          `The test command \`${args.test}\` failed with exit code ${run.exit} after your changes.`,
          "Fix the failures and keep the refactor intact. Output (tail):",
          "",
          tail(run.output),
        ].join("\n"),
      )
    }

    return yield* fail(`Tests still failing after ${attempts} attempt${attempts === 1 ? "" : "s"}.`)
  }),
})
