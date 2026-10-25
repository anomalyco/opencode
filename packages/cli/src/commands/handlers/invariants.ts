import fs from "node:fs"
import path from "node:path"
import { Effect } from "effect"
import { UI } from "../ui"
import { effectCmd, fail } from "../effect-cmd"
import { verdict } from "./review"

const FILE = path.join(".bolt", "invariants.md")
const FILE_LIMIT = 24_000
const TOTAL_LIMIT = 60_000
const DIFF_LIMIT = 60_000

/** Extract bulleted or numbered invariant lines from an agent response. */
export function extract(text: string) {
  return text
    .split("\n")
    .map((line) => line.trim())
    .flatMap((line) => {
      const match = line.match(/^(?:[-*]|\d+[.)])\s+(.+)$/)
      if (!match) return []
      return [match[1].trim()]
    })
    .filter((line) => line.length > 0)
}

/** Render the invariants document persisted between the state and verify phases. */
export function document(files: string[], invariants: string[]) {
  return ["# Invariants", "", `Files: ${files.join(", ")}`, "", ...invariants.map((line) => `- ${line}`), ""].join("\n")
}

/** Parse a persisted invariants document back into its files and invariants. */
export function parse(content: string) {
  const lines = content.split("\n")
  const header = lines.find((line) => line.startsWith("Files: "))
  const files = header
    ? header
        .slice("Files: ".length)
        .split(", ")
        .filter((name) => name.length > 0)
    : []
  return { files, invariants: extract(lines.filter((line) => line.startsWith("- ")).join("\n")) }
}

const STATE = [
  "You are about to refactor the files below. State the behavioral invariants that must still hold after the refactor: observable behaviors, input and output contracts, side effects, error handling, and edge cases callers rely on.",
  "Inspect surrounding code with the read, grep, and glob tools when the excerpts are not enough.",
  "Reply with one invariant per line as a markdown bullet starting with '- '. State only concrete, verifiable invariants. At most 15.",
].join("\n")

const VERIFY = [
  "A refactor was just performed. The invariants below were stated before it started.",
  "Verify each invariant still holds by inspecting the current code with the read, grep, and glob tools. The diff of the refactor is included for context.",
  "For each invariant, reply with a line starting with 'HOLDS' or 'VIOLATED' followed by the invariant and a one-line justification.",
  'End your final message with exactly one line: "Verdict: PASS" if every invariant holds, otherwise "Verdict: FAIL".',
].join("\n")

export const InvariantsCommand = effectCmd({
  command: "invariants <action> [files..]",
  describe: "state invariants before a refactor and verify them after",
  builder: (yargs) =>
    yargs
      .positional("action", {
        type: "string",
        choices: ["state", "verify"] as const,
        demandOption: true,
        describe: "state invariants before refactoring, or verify them afterwards",
      })
      .positional("files", {
        type: "string",
        array: true,
        default: [] as string[],
        describe: "files about to be refactored (state only)",
      })
      .option("range", {
        type: "string",
        describe: "git diff range for verify (defaults to HEAD, i.e. uncommitted changes)",
      })
      .option("model", {
        alias: "m",
        type: "string",
        describe: "model to use in the format of provider/model",
      }),
  handler: Effect.fn("Cli.invariants")(function* (args) {
    const { InstanceRef } = yield* Effect.promise(() => import("@/effect/instance-ref"))
    const { Git } = yield* Effect.promise(() => import("@/git"))
    const ctx = yield* InstanceRef
    if (!ctx) return yield* fail("Could not load instance context")
    if (ctx.project.vcs !== "git") {
      return yield* fail("Could not find git repository. Please run this command from a git repository.")
    }
    const cwd = ctx.worktree
    const store = path.join(cwd, FILE)

    const { Session } = yield* Effect.promise(() => import("@/session/session"))
    const { SessionPrompt } = yield* Effect.promise(() => import("@/session/prompt"))
    const { MessageID, PartID } = yield* Effect.promise(() => import("../../session/schema"))
    const { parseModel } = yield* Effect.promise(() => import("@/provider/provider"))
    const { extractResponseText } = yield* Effect.promise(() => import("./github.shared"))
    const sessions = yield* Session.Service
    const prompt = yield* SessionPrompt.Service

    const ask = (title: string, text: string) =>
      Effect.gen(function* () {
        const session = yield* sessions.create({
          title,
          permission: [{ permission: "question", action: "deny", pattern: "*" }],
        })
        const result = yield* prompt
          .prompt({
            sessionID: session.id,
            messageID: MessageID.ascending(),
            model: args.model ? parseModel(args.model) : undefined,
            parts: [{ id: PartID.ascending(), type: "text", text }],
          })
          .pipe(Effect.orDie)
        if (result.info.role === "assistant" && result.info.error) {
          const err = result.info.error
          const message = "message" in err.data ? err.data.message : ""
          return yield* fail(`${err.name}: ${message}`)
        }
        return extractResponseText(result.parts) ?? ""
      })

    if (args.action === "state") {
      if (args.files.length === 0) return yield* fail("Pass the files you are about to refactor.")
      const excerpts: string[] = []
      for (const file of args.files) {
        const target = path.resolve(cwd, file)
        const exists = yield* Effect.promise(() => Bun.file(target).exists())
        if (!exists) return yield* fail(`No such file: ${file}`)
        const content = yield* Effect.promise(() => Bun.file(target).text())
        excerpts.push(`### ${file}\n\n${content.slice(0, FILE_LIMIT)}`)
      }
      const body = excerpts.join("\n\n").slice(0, TOTAL_LIMIT)

      UI.println("Stating invariants...")
      const text = yield* ask("bolt invariants: state", `${STATE}\n\n${body}`)
      const invariants = extract(text)
      if (invariants.length === 0) return yield* fail("The model did not state any invariants.")

      fs.mkdirSync(path.dirname(store), { recursive: true })
      fs.writeFileSync(store, document(args.files, invariants))
      UI.empty()
      for (const line of invariants) UI.println(`- ${line}`)
      UI.empty()
      UI.println(`Saved ${invariants.length} invariants to ${FILE}. After refactoring, run: bolt invariants verify`)
      return
    }

    if (!fs.existsSync(store)) {
      return yield* fail(`No stated invariants found at ${FILE}. Run "bolt invariants state <files..>" first.`)
    }
    const saved = parse(fs.readFileSync(store, "utf8"))
    if (saved.invariants.length === 0) return yield* fail(`Could not parse any invariants from ${FILE}.`)

    const git = yield* Git.Service
    const diff = yield* git.run(["diff", args.range ?? "HEAD"], { cwd })
    if (diff.exitCode !== 0) return yield* fail(diff.stderr.toString().trim() || "git diff failed")
    const patch = diff.text().trim().slice(0, DIFF_LIMIT)

    UI.println(`Verifying ${saved.invariants.length} invariants...`)
    const text = yield* ask(
      "bolt invariants: verify",
      [
        VERIFY,
        "",
        `Files under refactor: ${saved.files.join(", ")}`,
        "",
        "Invariants:",
        ...saved.invariants.map((line) => `- ${line}`),
        "",
        "Diff:",
        patch || "(no diff; the refactor is already committed, inspect the files directly)",
      ].join("\n"),
    )
    if (!text) return yield* fail("The model returned an empty verification.")

    UI.empty()
    UI.println(UI.markdown(text))
    UI.empty()

    const outcome = verdict(text)
    if (outcome === "pass") return
    if (outcome === "fail") {
      process.exitCode = 1
      return
    }
    UI.println("Could not determine a verdict from the verification.")
    process.exitCode = 2
  }),
})
