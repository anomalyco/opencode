import { Effect, Schema } from "effect"
import { UI } from "../ui"
import { effectCmd, fail } from "../effect-cmd"

export type Transform = { pattern: string; rewrite: string; lang?: string }
export type Match = { file: string; line?: number; before: string; after?: string }

const INSTRUCTIONS = [
  "Produce an ast-grep transform for the requested code change in this repository.",
  "Use the glob, grep, and read tools to inspect the codebase so the pattern matches real code, not guessed code.",
  "Patterns and rewrites use ast-grep meta-variables: $NAME matches one node, $$$ARGS matches a list of nodes.",
  'End your final message with exactly one fenced json code block of the shape {"pattern": "...", "rewrite": "...", "lang": "..."} where lang is an ast-grep language identifier such as typescript, tsx, javascript, python, rust, or go.',
].join("\n")

/** Parse the transform out of the agent response: the last fenced json block wins. */
export function parseTransform(text: string): Transform | undefined {
  const fences = [...text.matchAll(/```(?:json)?\s*\n([\s\S]*?)```/g)]
  const last = fences.at(-1)
  if (!last) return undefined
  const parsed = Schema.decodeUnknownOption(Schema.UnknownFromJsonString)(last[1])
  if (parsed._tag === "None") return undefined
  const value = parsed.value
  if (typeof value !== "object" || value === null) return undefined
  const raw = value as Record<string, unknown>
  if (typeof raw.pattern !== "string" || typeof raw.rewrite !== "string" || !raw.pattern) return undefined
  return {
    pattern: raw.pattern,
    rewrite: raw.rewrite,
    lang: typeof raw.lang === "string" && raw.lang ? raw.lang : undefined,
  }
}

/** Build the ast-grep argv for a transform: streamed JSON for preview, --update-all for apply. */
export function buildArgs(input: Transform & { paths?: string[]; apply?: boolean }): string[] {
  return [
    "run",
    "--pattern",
    input.pattern,
    "--rewrite",
    input.rewrite,
    ...(input.lang ? ["--lang", input.lang] : []),
    ...(input.apply ? ["--update-all"] : ["--json=stream"]),
    ...(input.paths ?? []),
  ]
}

/** Parse ast-grep --json=stream output (one JSON match per line) into preview entries. */
export function parsePreview(output: string): Match[] {
  return output
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .flatMap((line) => {
      const parsed = Schema.decodeUnknownOption(Schema.UnknownFromJsonString)(line)
      if (parsed._tag === "None") return []
      const value = parsed.value
      if (typeof value !== "object" || value === null) return []
      const match = value as Record<string, unknown>
      if (typeof match.file !== "string" || typeof match.text !== "string") return []
      const range =
        typeof match.range === "object" && match.range !== null ? (match.range as Record<string, unknown>) : {}
      const start =
        typeof range.start === "object" && range.start !== null ? (range.start as Record<string, unknown>) : {}
      return [
        {
          file: match.file,
          line: typeof start.line === "number" ? start.line + 1 : undefined,
          before: match.text,
          after: typeof match.replacement === "string" ? match.replacement : undefined,
        },
      ]
    })
}

/** Render preview entries as a grouped, diff-style listing. */
export function render(matches: Match[]): string {
  const grouped = new Map<string, Match[]>()
  for (const match of matches) {
    const entries = grouped.get(match.file) ?? []
    entries.push(match)
    grouped.set(match.file, entries)
  }
  return [...grouped.entries()]
    .map(([file, entries]) =>
      [
        file,
        ...entries.flatMap((entry) => [
          ...(entry.line === undefined ? [] : [`  @ line ${entry.line}`]),
          ...entry.before.split("\n").map((line) => `  - ${line}`),
          ...(entry.after ?? "").split("\n").map((line) => `  + ${line}`),
        ]),
      ].join("\n"),
    )
    .join("\n\n")
}

export const CodemodCommand = effectCmd({
  command: "codemod [description]",
  describe: "generate an ast-grep transform, preview the diff, and apply it with --apply",
  builder: (yargs) =>
    yargs
      .positional("description", {
        type: "string",
        describe: "natural language description of the transform to generate",
      })
      .option("pattern", {
        type: "string",
        describe: "explicit ast-grep pattern; skips the agent (requires --rewrite)",
      })
      .option("rewrite", {
        type: "string",
        describe: "explicit ast-grep rewrite; skips the agent (requires --pattern)",
      })
      .option("lang", {
        type: "string",
        describe: "ast-grep language identifier, e.g. typescript, tsx, python",
      })
      .option("apply", {
        type: "boolean",
        describe: "write the rewrites to disk (default is preview only)",
        default: false,
      })
      .option("model", {
        alias: "m",
        type: "string",
        describe: "model to use in the format of provider/model",
      })
      .implies("pattern", "rewrite")
      .implies("rewrite", "pattern"),
  handler: Effect.fn("Cli.codemod")(function* (args) {
    const { InstanceRef } = yield* Effect.promise(() => import("@/effect/instance-ref"))
    const ctx = yield* InstanceRef
    if (!ctx) return yield* fail("Could not load instance context")
    const cwd = ctx.worktree

    const binary = Bun.which("ast-grep") ?? Bun.which("sg")
    if (!binary) return yield* fail("ast-grep is not installed. Install it from https://ast-grep.github.io/")

    if (!args.pattern && !args.description) {
      return yield* fail('Describe the transform (bolt codemod "...") or pass --pattern and --rewrite.')
    }

    const transform = args.pattern
      ? { pattern: args.pattern, rewrite: args.rewrite!, lang: args.lang }
      : yield* generate(args.description!, args.model)
    if (!args.pattern) {
      UI.println(`pattern: ${transform.pattern}`)
      UI.println(`rewrite: ${transform.rewrite}`)
      if (transform.lang) UI.println(`lang: ${transform.lang}`)
      UI.empty()
    }

    const run = (argv: string[]) =>
      Effect.promise(async () => {
        const proc = Bun.spawn([binary, ...argv], { cwd, stdout: "pipe", stderr: "pipe" })
        const stdout = await new Response(proc.stdout).text()
        const stderr = await new Response(proc.stderr).text()
        const code = await proc.exited
        return { code, stdout, stderr }
      })

    const preview = yield* run(buildArgs(transform))
    if (preview.code !== 0) return yield* fail(preview.stderr.trim() || "ast-grep failed")
    const matches = parsePreview(preview.stdout)
    if (matches.length === 0) {
      UI.println("No matches found.")
      return
    }

    UI.println(render(matches))
    UI.empty()
    const files = new Set(matches.map((match) => match.file)).size
    UI.println(`${matches.length} rewrite(s) in ${files} file(s).`)

    if (!args.apply) {
      UI.println("Preview only. Re-run with --apply to write these changes.")
      return
    }

    const applied = yield* run(buildArgs({ ...transform, apply: true }))
    if (applied.code !== 0) return yield* fail(applied.stderr.trim() || "ast-grep failed while applying")
    UI.println(`Applied ${matches.length} rewrite(s) across ${files} file(s).`)
  }),
})

/** Ask the agent headlessly for an ast-grep pattern and rewrite matching the description. */
const generate = Effect.fn("Cli.codemod.generate")(function* (description: string, model?: string) {
  UI.println("Generating transform...")
  const { Session } = yield* Effect.promise(() => import("@/session/session"))
  const { SessionPrompt } = yield* Effect.promise(() => import("@/session/prompt"))
  const { MessageID, PartID } = yield* Effect.promise(() => import("../../session/schema"))
  const { parseModel } = yield* Effect.promise(() => import("@/provider/provider"))
  const { extractResponseText } = yield* Effect.promise(() => import("./github.shared"))
  const sessions = yield* Session.Service
  const prompt = yield* SessionPrompt.Service
  const session = yield* sessions.create({
    title: "bolt codemod",
    permission: [
      { permission: "question", action: "deny", pattern: "*" },
      { permission: "edit", action: "deny", pattern: "*" },
    ],
  })

  const result = yield* prompt
    .prompt({
      sessionID: session.id,
      messageID: MessageID.ascending(),
      agent: "plan",
      model: model ? parseModel(model) : undefined,
      parts: [
        {
          id: PartID.ascending(),
          type: "text",
          text: `${INSTRUCTIONS}\n\nRequested transform: ${description}`,
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
  const transform = parseTransform(text)
  if (!transform) {
    return yield* fail(
      "The model did not return a usable transform. Re-run or pass --pattern and --rewrite explicitly.",
    )
  }
  return transform
})
