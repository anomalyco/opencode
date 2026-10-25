import path from "node:path"
import { Effect } from "effect"
import { UI } from "../ui"
import { effectCmd, fail } from "../effect-cmd"

const FINDING_LIMIT = 100
const LISTING_LIMIT = 30_000

export type Mined = {
  name: string
  line: number
  expects: number
  weak: number
}

const START = /(?:^|[^\w.])(?:test|it)(?:\.\w+)?\(\s*["'`](.*?)["'`]/
const WEAK = [/\.toBeTruthy\(/g, /\.toBeFalsy\(/g, /\.toBeDefined\(/g, /\.not\.toThrow\(/g, /\.toMatchSnapshot\(/g]

/** Parse a test file into its test blocks with assertion counts. */
export function mine(source: string) {
  const blocks: Mined[] = []
  source.split("\n").forEach((text, index) => {
    const match = text.match(START)
    if (match) {
      blocks.push({ name: match[1], line: index + 1, expects: 0, weak: 0 })
    }
    const current = blocks.at(-1)
    if (!current) return
    // Count assertions on the start line too, for one-line arrow tests.
    const body = match ? text.slice((match.index ?? 0) + match[0].length) : text
    current.expects += (body.match(/\bexpect\s*\(/g) ?? []).length + (body.match(/\bassert[.(]/g) ?? []).length
    current.weak += WEAK.reduce((sum, weak) => sum + (body.match(weak) ?? []).length, 0)
  })
  return blocks
}

export type Finding = {
  kind: "none" | "weak"
  block: Mined
}

/** Flag test blocks with no assertions or only weak ones. */
export function findings(blocks: Mined[]) {
  return blocks.flatMap((block): Finding[] => {
    if (block.expects === 0) return [{ kind: "none", block }]
    if (block.weak >= block.expects) return [{ kind: "weak", block }]
    return []
  })
}

const INSTRUCTIONS = [
  "The test blocks listed below either have no assertions or rely only on weak ones (toBeTruthy, toBeDefined, snapshot-only, and similar).",
  "Read each test file and the code under test with the read, grep, and glob tools, then suggest the specific missing assertions: what exact values or shapes each test should assert to actually pin the behavior down.",
  "Do NOT edit any files. Reply with one section per test, each containing the suggested expect(...) lines in a fenced code block.",
].join("\n")

export const AssertsCommand = effectCmd({
  command: "asserts [files..]",
  describe: "find tests with missing or weak assertions and suggest better ones",
  builder: (yargs) =>
    yargs
      .positional("files", {
        type: "string",
        array: true,
        default: [] as string[],
        describe: "test files to scan (defaults to the test files changed in the current diff)",
      })
      .option("branch", {
        type: "string",
        describe: "scan test files changed since the merge base with a branch instead of the working tree",
      })
      .option("suggest", {
        type: "boolean",
        default: false,
        describe: "ask the agent to suggest the missing assertions",
      })
      .option("model", {
        alias: "m",
        type: "string",
        describe: "model to use in the format of provider/model",
      }),
  handler: Effect.fn("Cli.asserts")(function* (args) {
    const { InstanceRef } = yield* Effect.promise(() => import("@/effect/instance-ref"))
    const { Git } = yield* Effect.promise(() => import("@/git"))
    const ctx = yield* InstanceRef
    if (!ctx) return yield* fail("Could not load instance context")
    const cwd = ctx.worktree

    const files: string[] = yield* Effect.gen(function* () {
      if (args.files.length > 0) return args.files
      if (ctx.project.vcs !== "git") return yield* fail("Not a git repository. Pass the test files to scan explicitly.")
      const git = yield* Git.Service
      const range = yield* Effect.gen(function* () {
        if (args.branch === undefined) return ["diff", "--name-only", "HEAD"]
        const base = args.branch || (yield* git.defaultBranch(cwd).pipe(Effect.map((branch) => branch?.ref)))
        if (!base) return yield* fail("Could not determine the default branch. Pass one with --branch <name>.")
        const merge = yield* git.mergeBase(cwd, base)
        if (!merge) return yield* fail(`Could not find a merge base with ${base}.`)
        return ["diff", "--name-only", `${merge}..HEAD`]
      })
      const run = yield* git.run(range, { cwd })
      if (run.exitCode !== 0) return yield* fail(run.stderr.toString().trim() || "git diff failed")
      return run
        .text()
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.length > 0)
    })

    const targets = files.filter((file: string) => /(?:\.test\.|\.spec\.|_test\.|(?:^|[\\/])test_)/.test(file))
    if (targets.length === 0) {
      UI.println("No test files to scan.")
      return
    }

    const flagged: { file: string; finding: Finding }[] = []
    let total = 0
    for (const file of targets) {
      const target = path.resolve(cwd, file)
      const exists = yield* Effect.promise(() => Bun.file(target).exists())
      if (!exists) continue
      const source = yield* Effect.promise(() => Bun.file(target).text())
      const blocks = mine(source)
      total += blocks.length
      for (const finding of findings(blocks)) {
        flagged.push({ file, finding })
      }
    }

    if (flagged.length === 0) {
      UI.println(`Scanned ${total} test${total === 1 ? "" : "s"}: every test asserts something concrete.`)
      return
    }

    const capped = flagged.slice(0, FINDING_LIMIT)
    UI.println(`Found ${flagged.length} test${flagged.length === 1 ? "" : "s"} with missing or weak assertions:`)
    for (const entry of capped) {
      const label = entry.finding.kind === "none" ? "no assertions" : "only weak assertions"
      UI.println(`  ${entry.file}:${entry.finding.block.line} [${label}] ${entry.finding.block.name}`)
    }
    if (flagged.length > capped.length) UI.println(`  ...and ${flagged.length - capped.length} more`)
    process.exitCode = 1

    if (!args.suggest) {
      UI.empty()
      UI.println("Suggest the missing assertions with: bolt asserts --suggest")
      return
    }

    UI.empty()
    UI.println("Asking the agent for the missing assertions...")
    const { Session } = yield* Effect.promise(() => import("@/session/session"))
    const { SessionPrompt } = yield* Effect.promise(() => import("@/session/prompt"))
    const { MessageID, PartID } = yield* Effect.promise(() => import("../../session/schema"))
    const { parseModel } = yield* Effect.promise(() => import("@/provider/provider"))
    const { extractResponseText } = yield* Effect.promise(() => import("./github.shared"))
    const sessions = yield* Session.Service
    const prompt = yield* SessionPrompt.Service
    const session = yield* sessions.create({
      title: "bolt asserts",
      permission: [{ permission: "question", action: "deny", pattern: "*" }],
    })

    const listing = capped
      .map((entry) => {
        const label = entry.finding.kind === "none" ? "no assertions" : "only weak assertions"
        return `- ${entry.file}:${entry.finding.block.line} [${label}] ${entry.finding.block.name}`
      })
      .join("\n")
      .slice(0, LISTING_LIMIT)
    const result = yield* prompt
      .prompt({
        sessionID: session.id,
        messageID: MessageID.ascending(),
        model: args.model ? parseModel(args.model) : undefined,
        parts: [{ id: PartID.ascending(), type: "text", text: `${INSTRUCTIONS}\n\nTests:\n${listing}` }],
      })
      .pipe(Effect.orDie)

    if (result.info.role === "assistant" && result.info.error) {
      const err = result.info.error
      const message = "message" in err.data ? err.data.message : ""
      return yield* fail(`${err.name}: ${message}`)
    }
    const text = extractResponseText(result.parts) ?? ""
    if (!text) return yield* fail("The model returned an empty suggestion.")

    UI.empty()
    UI.println(UI.markdown(text))
  }),
})
