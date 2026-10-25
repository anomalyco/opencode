import { Effect } from "effect"
import { UI } from "../ui"
import { effectCmd, fail } from "../effect-cmd"

const LIMIT = 60_000

/** Strip think blocks and markdown fences from a generated commit message. */
export function clean(text: string) {
  const lines = text
    .replace(/<think>[\s\S]*?<\/think>/g, "")
    .trim()
    .split("\n")
  if (lines[0]?.startsWith("```")) lines.shift()
  if (lines.at(-1)?.startsWith("```")) lines.pop()
  return lines.join("\n").trim()
}

/** Cap a diff for the prompt, keeping the head where the summary lives. */
export function cap(patch: string, limit = LIMIT) {
  if (patch.length <= limit) return patch
  return `${patch.slice(0, limit)}\n\n[diff truncated]`
}

export const CommitCommand = effectCmd({
  command: "commit",
  describe: "commit staged changes with a generated message",
  builder: (yargs) =>
    yargs
      .option("all", {
        alias: "a",
        type: "boolean",
        describe: "commit all tracked changes, not just staged ones",
        default: false,
      })
      .option("dry-run", {
        type: "boolean",
        describe: "print the generated message without committing",
        default: false,
      })
      .option("model", {
        alias: "m",
        type: "string",
        describe: "model to use in the format of provider/model",
      }),
  handler: Effect.fn("Cli.commit")(function* (args) {
    const { InstanceRef } = yield* Effect.promise(() => import("@/effect/instance-ref"))
    const { Git } = yield* Effect.promise(() => import("@/git"))
    const ctx = yield* InstanceRef
    if (!ctx) return yield* fail("Could not load instance context")
    if (ctx.project.vcs !== "git") {
      return yield* fail("Could not find git repository. Please run this command from a git repository.")
    }

    const git = yield* Git.Service
    const cwd = ctx.worktree

    if (args.all && !(yield* git.hasHead(cwd))) {
      return yield* fail("--all requires at least one commit. Stage changes and run bolt commit instead.")
    }

    const diff = yield* git.run(args.all ? ["diff", "HEAD"] : ["diff", "--cached"], { cwd })
    if (diff.exitCode !== 0) return yield* fail(diff.stderr.toString().trim() || "git diff failed")
    const patch = diff.text().trim()
    if (!patch) {
      return yield* fail(
        args.all
          ? "No changes to commit."
          : "No staged changes to commit. Stage changes with git add, or pass --all to commit every tracked change.",
      )
    }

    const log = yield* git.run(["log", "--format=%s", "-10"], { cwd })
    const subjects = log.exitCode === 0 ? log.text().trim() : ""

    UI.println("Generating commit message...")

    const { Session } = yield* Effect.promise(() => import("@/session/session"))
    const { SessionPrompt } = yield* Effect.promise(() => import("@/session/prompt"))
    const { MessageID, PartID } = yield* Effect.promise(() => import("../../session/schema"))
    const { parseModel } = yield* Effect.promise(() => import("@/provider/provider"))
    const { extractResponseText } = yield* Effect.promise(() => import("./github.shared"))
    const sessions = yield* Session.Service
    const prompt = yield* SessionPrompt.Service
    const session = yield* sessions.create({
      title: "bolt commit",
      permission: [{ permission: "question", action: "deny", pattern: "*" }],
    })

    const text = [
      "Write a commit message for the following staged changes.",
      subjects ? `\nRecent commit subjects for style reference:\n${subjects}` : "",
      `\nDiff:\n${cap(patch)}`,
    ].join("\n")

    const result = yield* prompt
      .prompt({
        sessionID: session.id,
        messageID: MessageID.ascending(),
        agent: "commit",
        model: args.model ? parseModel(args.model) : undefined,
        parts: [{ id: PartID.ascending(), type: "text", text }],
      })
      .pipe(Effect.orDie)

    if (result.info.role === "assistant" && result.info.error) {
      const err = result.info.error
      const message = "message" in err.data ? err.data.message : ""
      return yield* fail(`${err.name}: ${message}`)
    }

    const message = clean(extractResponseText(result.parts) ?? "")
    if (!message) return yield* fail("The model returned an empty commit message.")

    if (args["dry-run"]) {
      UI.empty()
      UI.println(message)
      return
    }

    const commit = yield* git.run(args.all ? ["commit", "-a", "-m", message] : ["commit", "-m", message], { cwd })
    if (commit.exitCode !== 0) return yield* fail(commit.stderr.toString().trim() || "git commit failed")
    UI.empty()
    UI.println(commit.text().trim())
  }),
})
