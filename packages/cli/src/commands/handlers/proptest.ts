import path from "node:path"
import { Effect } from "effect"
import { UI } from "../ui"
import { effectCmd, fail } from "../effect-cmd"

const OUTPUT_LIMIT = 10_000
const FILE_LIMIT = 40_000

/** Parse the last `Name: value` marker line from an agent response. */
export function marker(text: string, name: string) {
  const matches = [...text.matchAll(new RegExp(`^${name}:\\s*(.+)$`, "gim"))]
  const last = matches.at(-1)
  if (!last) return undefined
  const value = last[1].trim().replace(/^`+|`+$/g, "")
  if (!value) return undefined
  return value
}

export type Candidate = {
  name: string
  line: number
  signature: string
}

// Async functions and generators are excluded up front: they are never pure.
// The remaining candidates are only *candidates*; the agent decides purity by
// reading the bodies.
const declarations = [/^export function (\w+)\s*\(/, /^export const (\w+)\s*=\s*(?:\([^)]*\)|\w+)\s*(?::[^=]+)?=>/]

/** Extract exported function candidates that could be pure, with their line numbers. */
export function candidates(source: string) {
  return source.split("\n").flatMap((text, index) => {
    const line = text.trimEnd()
    return declarations.flatMap((declaration) => {
      const match = line.match(declaration)
      if (!match) return []
      return [
        {
          name: match[1],
          line: index + 1,
          signature: line.trim().slice(0, 200),
        } satisfies Candidate,
      ]
    })
  })
}

const INSTRUCTIONS = [
  "Generate property-based tests for the pure exported functions listed below. First read the file and decide which candidates are actually pure (no I/O, no mutation of external state, deterministic output for the same input); skip the impure ones.",
  "For each pure function, test properties rather than single examples: round-trips, idempotence, invariants over outputs, commutativity, or agreement with a simple oracle. Generate many inputs per property with a seeded pseudo-random generator so runs are deterministic.",
  "Do NOT add any dependency. Use the project's existing test framework and conventions; inspect neighboring tests with the read, grep, and glob tools first. Create exactly one new test file with the write tool and do not modify any other file.",
  "End your final message with exactly two lines:",
  "Test: <path of the test file you created, relative to the repository root>",
  "Command: <shell command that runs exactly that test file>",
].join("\n")

export const ProptestCommand = effectCmd({
  command: "proptest <file>",
  describe: "generate property-based tests for the pure functions in a file",
  builder: (yargs) =>
    yargs
      .positional("file", {
        type: "string",
        demandOption: true,
        describe: "source file whose exported pure functions should get property tests",
      })
      .option("name", {
        type: "string",
        describe: "only target the exported function with this name",
      })
      .option("model", {
        alias: "m",
        type: "string",
        describe: "model to use in the format of provider/model",
      }),
  handler: Effect.fn("Cli.proptest")(function* (args) {
    const { InstanceRef } = yield* Effect.promise(() => import("@/effect/instance-ref"))
    const ctx = yield* InstanceRef
    if (!ctx) return yield* fail("Could not load instance context")
    const cwd = ctx.worktree
    const target = path.resolve(cwd, args.file)
    const exists = yield* Effect.promise(() => Bun.file(target).exists())
    if (!exists) return yield* fail(`No such file: ${args.file}`)

    const source = yield* Effect.promise(() => Bun.file(target).text())
    const found = candidates(source)
    const chosen = args.name ? found.filter((candidate) => candidate.name === args.name) : found
    if (chosen.length === 0) {
      return yield* fail(
        args.name
          ? `No exported function candidate named "${args.name}" in ${args.file}.`
          : `No exported function candidates found in ${args.file}.`,
      )
    }

    UI.println(`Found ${chosen.length} candidate${chosen.length === 1 ? "" : "s"}:`)
    for (const candidate of chosen) UI.println(`  ${args.file}:${candidate.line} ${candidate.name}`)
    UI.println("Generating property-based tests...")

    const { Session } = yield* Effect.promise(() => import("@/session/session"))
    const { SessionPrompt } = yield* Effect.promise(() => import("@/session/prompt"))
    const { MessageID, PartID } = yield* Effect.promise(() => import("../../session/schema"))
    const { parseModel } = yield* Effect.promise(() => import("@/provider/provider"))
    const { extractResponseText } = yield* Effect.promise(() => import("./github.shared"))
    const sessions = yield* Session.Service
    const prompt = yield* SessionPrompt.Service
    const session = yield* sessions.create({
      title: `bolt proptest: ${args.file}`,
      permission: [{ permission: "question", action: "deny", pattern: "*" }],
    })

    const listing = chosen.map((candidate) => `- ${candidate.name} (line ${candidate.line}): ${candidate.signature}`)
    const result = yield* prompt
      .prompt({
        sessionID: session.id,
        messageID: MessageID.ascending(),
        model: args.model ? parseModel(args.model) : undefined,
        parts: [
          {
            id: PartID.ascending(),
            type: "text",
            text: [
              INSTRUCTIONS,
              "",
              `File: ${args.file}`,
              "",
              "Candidates:",
              ...listing,
              "",
              "Source:",
              source.slice(0, FILE_LIMIT),
            ].join("\n"),
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
    if (!text) return yield* fail("The model returned an empty response.")

    const file = marker(text, "Test")
    const command = marker(text, "Command")
    if (!file || !command) {
      UI.println(UI.markdown(text))
      return yield* fail("The model did not report the Test: and Command: markers.")
    }
    const written = path.resolve(cwd, file)
    const created = yield* Effect.promise(() => Bun.file(written).exists())
    if (!created) return yield* fail(`The model reported ${file}, but that file does not exist.`)

    UI.println(`Test written: ${file}`)
    UI.println(`Running "${command}" to confirm the properties hold...`)
    const shell = process.platform === "win32" ? ["cmd", "/c", command] : ["sh", "-c", command]
    const run = yield* Effect.promise(async () => {
      const proc = Bun.spawn(shell, { cwd, stdout: "pipe", stderr: "pipe" })
      const [out, err] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()])
      const code = await proc.exited
      return { code, output: [out.trim(), err.trim()].filter(Boolean).join("\n") }
    })

    UI.empty()
    if (run.code !== 0) {
      UI.println(run.output.slice(-OUTPUT_LIMIT))
      UI.empty()
      UI.println(
        `The generated properties FAIL (exit ${run.code}). Either a property found a real bug or the test is wrong; inspect ${file}.`,
      )
      process.exitCode = 1
      return
    }
    UI.println(`All properties hold. Keep ${file} to lock the behavior in.`)
  }),
})
