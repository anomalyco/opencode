import { Effect } from "effect"
import { UI } from "../ui"
import { effectCmd, fail } from "../effect-cmd"
import { INSTRUCTIONS, verdict } from "./review"

const LIMIT = 120_000

export const SEVERITIES = ["minor", "major", "critical"] as const
export type Severity = (typeof SEVERITIES)[number]

/** Numeric rank for comparing severities. */
export function rank(severity: Severity) {
  return SEVERITIES.indexOf(severity)
}

export interface Issue {
  severity: Severity
  line: string
}

/**
 * Extract reported defects from a review response. The review agent is asked
 * to report each issue as a list item with a severity, so only list items
 * carrying a severity word count; the verdict marker line never does.
 */
export function issues(text: string): Issue[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => /^(?:[-*]|\d+[.)])\s+/.test(line))
    .flatMap((line) => {
      const match = line.match(/\b(critical|major|minor)\b/i)
      if (!match) return []
      return [{ severity: match[1].toLowerCase() as Severity, line }]
    })
}

/** Issues at or above the threshold; these fail the gate. */
export function blocking(found: Issue[], threshold: Severity) {
  return found.filter((issue) => rank(issue.severity) >= rank(threshold))
}

export const DiffGateCommand = effectCmd({
  command: "diff-gate",
  describe: "review a diff from stdin and exit 1 when defects reach a severity threshold",
  builder: (yargs) =>
    yargs
      .option("threshold", {
        type: "string",
        choices: [...SEVERITIES],
        default: "major" as Severity,
        describe: "lowest severity that fails the gate",
      })
      .option("model", {
        alias: "m",
        type: "string",
        describe: "model to use in the format of provider/model",
      }),
  handler: Effect.fn("Cli.diffGate")(function* (args) {
    if (process.stdin.isTTY) {
      return yield* fail("No diff on stdin. Pipe one in, e.g.: git diff origin/dev...HEAD | bolt diff-gate")
    }
    const patch = (yield* Effect.promise(() => Bun.stdin.text())).trim()
    if (!patch) return yield* fail("The diff on stdin is empty.")
    if (patch.length > LIMIT) {
      return yield* fail("The diff is too large to review in one shot. Gate a narrower range.")
    }

    UI.println(`Reviewing diff (${patch.length} chars, threshold: ${args.threshold})...`)

    const { Session } = yield* Effect.promise(() => import("@/session/session"))
    const { SessionPrompt } = yield* Effect.promise(() => import("@/session/prompt"))
    const { MessageID, PartID } = yield* Effect.promise(() => import("../../session/schema"))
    const { parseModel } = yield* Effect.promise(() => import("@/provider/provider"))
    const { extractResponseText } = yield* Effect.promise(() => import("./github.shared"))
    const sessions = yield* Session.Service
    const prompter = yield* SessionPrompt.Service
    const session = yield* sessions.create({
      title: "bolt diff-gate",
      permission: [{ permission: "question", action: "deny", pattern: "*" }],
    })

    const result = yield* prompter
      .prompt({
        sessionID: session.id,
        messageID: MessageID.ascending(),
        agent: "code-review",
        model: args.model ? parseModel(args.model) : undefined,
        parts: [{ id: PartID.ascending(), type: "text", text: `${INSTRUCTIONS}\n\nDiff:\n${patch}` }],
      })
      .pipe(Effect.orDie)

    if (result.info.role === "assistant" && result.info.error) {
      const err = result.info.error
      const message = "message" in err.data ? err.data.message : ""
      return yield* fail(`${err.name}: ${message}`)
    }

    const text = extractResponseText(result.parts) ?? ""
    if (!text) return yield* fail("The model returned an empty review.")

    UI.empty()
    UI.println(UI.markdown(text))
    UI.empty()

    const found = issues(text)
    const failing = blocking(found, args.threshold as Severity)
    if (failing.length > 0) {
      UI.error(`${failing.length} defect${failing.length === 1 ? "" : "s"} at or above ${args.threshold}`)
      process.exitCode = 1
      return
    }
    if (found.length > 0) {
      UI.println(`${found.length} defect${found.length === 1 ? "" : "s"} below the ${args.threshold} threshold.`)
      return
    }

    // No parseable defect list: fall back to the review verdict marker.
    const outcome = verdict(text)
    if (outcome === "pass") return
    if (outcome === "fail") {
      UI.error("The review reported a failing verdict.")
      process.exitCode = 1
      return
    }
    UI.println("Could not determine a verdict from the review.")
    process.exitCode = 2
  }),
})
