import path from "node:path"
import { Effect } from "effect"
import { UI } from "../ui"
import { effectCmd, fail } from "../effect-cmd"

const FINDING_LIMIT = 100
const EXCERPT_LIMIT = 30_000
const EXTENSIONS = [".ts", ".tsx", ".mts", ".cts"]

export type Finding = {
  line: number
  kind: string
  text: string
}

// One entry per loose-type shape worth tightening. Suppression comments are
// scanned everywhere; the code patterns skip comment lines.
const patterns: { pattern: RegExp; kind: string }[] = [
  { pattern: /\bas any\b/, kind: "as any" },
  { pattern: /\bas unknown\b/, kind: "as unknown" },
  { pattern: /:\s*any\b/, kind: ": any" },
  { pattern: /\bany\[\]/, kind: "any[]" },
  { pattern: /<any[,>]/, kind: "<any>" },
  { pattern: /:\s*Function\b/, kind: ": Function" },
  { pattern: /:\s*object\b/, kind: ": object" },
  { pattern: /@ts-(?:ignore|expect-error|nocheck)/, kind: "suppression" },
]

/** Find loose-type sites in a TypeScript source file. */
export function loose(source: string) {
  return source.split("\n").flatMap((text, index) => {
    const trimmed = text.trim()
    const comment = trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*")
    return patterns.flatMap((entry) => {
      if (comment && entry.kind !== "suppression") return []
      if (!entry.pattern.test(text)) return []
      return [{ line: index + 1, kind: entry.kind, text: trimmed.slice(0, 160) } satisfies Finding]
    })
  })
}

const INSTRUCTIONS = [
  "Propose stricter types for the loose-type sites listed below. Inspect the files with the read, grep, and glob tools to understand what each value actually is at runtime.",
  "For each site, propose the tightest type that is honest: a concrete interface, a union, a generic, or an Effect Schema where the codebase already uses one. If a site genuinely cannot be tightened, say why in one line.",
  "Do NOT edit any files. Reply with one section per file containing the proposed replacements as fenced diff blocks.",
].join("\n")

export const TightenCommand = effectCmd({
  command: "tighten [files..]",
  describe: "find loose types in changed code and propose stricter ones",
  builder: (yargs) =>
    yargs
      .positional("files", {
        type: "string",
        array: true,
        default: [] as string[],
        describe: "files to scan (defaults to the files changed in the current diff)",
      })
      .option("branch", {
        type: "string",
        describe: "scan files changed since the merge base with a branch instead of the working tree",
      })
      .option("suggest", {
        type: "boolean",
        default: false,
        describe: "ask the agent to propose stricter types for each finding",
      })
      .option("model", {
        alias: "m",
        type: "string",
        describe: "model to use in the format of provider/model",
      }),
  handler: Effect.fn("Cli.tighten")(function* (args) {
    const { InstanceRef } = yield* Effect.promise(() => import("@/effect/instance-ref"))
    const { Git } = yield* Effect.promise(() => import("@/git"))
    const ctx = yield* InstanceRef
    if (!ctx) return yield* fail("Could not load instance context")
    const cwd = ctx.worktree

    const files = yield* Effect.gen(function* () {
      if (args.files.length > 0) return args.files
      if (ctx.project.vcs !== "git") return yield* fail("Not a git repository. Pass the files to scan explicitly.")
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

    const targets = files.filter((file: string) => EXTENSIONS.includes(path.extname(file)))
    if (targets.length === 0) {
      UI.println("No TypeScript files to scan.")
      return
    }

    const findings: { file: string; finding: Finding }[] = []
    for (const file of targets) {
      const target = path.resolve(cwd, file)
      const exists = yield* Effect.promise(() => Bun.file(target).exists())
      if (!exists) continue
      const source = yield* Effect.promise(() => Bun.file(target).text())
      for (const finding of loose(source)) {
        findings.push({ file, finding })
      }
    }

    if (findings.length === 0) {
      UI.println(`Scanned ${targets.length} file${targets.length === 1 ? "" : "s"}: no loose types found.`)
      return
    }

    const capped = findings.slice(0, FINDING_LIMIT)
    UI.println(`Found ${findings.length} loose-type site${findings.length === 1 ? "" : "s"}:`)
    for (const entry of capped) {
      UI.println(`  ${entry.file}:${entry.finding.line} [${entry.finding.kind}] ${entry.finding.text}`)
    }
    if (findings.length > capped.length) UI.println(`  ...and ${findings.length - capped.length} more`)
    process.exitCode = 1

    if (!args.suggest) {
      UI.empty()
      UI.println("Propose stricter types with: bolt tighten --suggest")
      return
    }

    UI.empty()
    UI.println("Asking the agent for stricter types...")
    const { Session } = yield* Effect.promise(() => import("@/session/session"))
    const { SessionPrompt } = yield* Effect.promise(() => import("@/session/prompt"))
    const { MessageID, PartID } = yield* Effect.promise(() => import("../../session/schema"))
    const { parseModel } = yield* Effect.promise(() => import("@/provider/provider"))
    const { extractResponseText } = yield* Effect.promise(() => import("./github.shared"))
    const sessions = yield* Session.Service
    const prompt = yield* SessionPrompt.Service
    const session = yield* sessions.create({
      title: "bolt tighten",
      permission: [{ permission: "question", action: "deny", pattern: "*" }],
    })

    const listing = capped
      .map((entry) => `- ${entry.file}:${entry.finding.line} [${entry.finding.kind}] ${entry.finding.text}`)
      .join("\n")
      .slice(0, EXCERPT_LIMIT)
    const result = yield* prompt
      .prompt({
        sessionID: session.id,
        messageID: MessageID.ascending(),
        model: args.model ? parseModel(args.model) : undefined,
        parts: [{ id: PartID.ascending(), type: "text", text: `${INSTRUCTIONS}\n\nSites:\n${listing}` }],
      })
      .pipe(Effect.orDie)

    if (result.info.role === "assistant" && result.info.error) {
      const err = result.info.error
      const message = "message" in err.data ? err.data.message : ""
      return yield* fail(`${err.name}: ${message}`)
    }
    const text = extractResponseText(result.parts) ?? ""
    if (!text) return yield* fail("The model returned an empty proposal.")

    UI.empty()
    UI.println(UI.markdown(text))
  }),
})
