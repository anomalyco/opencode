import path from "node:path"
import { Effect } from "effect"
import { UI } from "../ui"
import { effectCmd, fail } from "../effect-cmd"

const OUTPUT_LIMIT = 10_000

/** Parse the last `Name: value` marker line from an agent response. */
export function marker(text: string, name: string) {
  const matches = [...text.matchAll(new RegExp(`^${name}:\\s*(.+)$`, "gim"))]
  const last = matches.at(-1)
  if (!last) return undefined
  const value = last[1].trim().replace(/^`+|`+$/g, "")
  if (!value) return undefined
  return value
}

const INSTRUCTIONS = [
  "Write a minimal automated test that reproduces the bug described below. The test must FAIL on the current code because the bug is still present, and it must pass once the bug is fixed.",
  "Inspect the codebase with the read, grep, and glob tools to find the buggy code and the existing test conventions. Place the test where this project keeps its tests, following its naming style, and create it with the write tool. Do NOT fix the bug itself and do NOT touch any other file.",
  "End your final message with exactly two lines:",
  "Test: <path of the test file you created, relative to the repository root>",
  "Command: <shell command that runs exactly that test file>",
].join("\n")

export const GuardCommand = effectCmd({
  command: "guard <bug>",
  describe: "generate a failing regression test from a bug description before fixing it",
  builder: (yargs) =>
    yargs
      .positional("bug", {
        type: "string",
        demandOption: true,
        describe: 'bug description, e.g. "parse() drops the last row when the file has no trailing newline"',
      })
      .option("model", {
        alias: "m",
        type: "string",
        describe: "model to use in the format of provider/model",
      }),
  handler: Effect.fn("Cli.guard")(function* (args) {
    const { InstanceRef } = yield* Effect.promise(() => import("@/effect/instance-ref"))
    const ctx = yield* InstanceRef
    if (!ctx) return yield* fail("Could not load instance context")
    const cwd = ctx.worktree

    UI.println("Writing a regression test that reproduces the bug...")
    const { Session } = yield* Effect.promise(() => import("@/session/session"))
    const { SessionPrompt } = yield* Effect.promise(() => import("@/session/prompt"))
    const { MessageID, PartID } = yield* Effect.promise(() => import("../../session/schema"))
    const { parseModel } = yield* Effect.promise(() => import("@/provider/provider"))
    const { extractResponseText } = yield* Effect.promise(() => import("./github.shared"))
    const sessions = yield* Session.Service
    const prompt = yield* SessionPrompt.Service
    const session = yield* sessions.create({
      title: `bolt guard: ${args.bug.slice(0, 60)}`,
      permission: [{ permission: "question", action: "deny", pattern: "*" }],
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
            text: `${INSTRUCTIONS}\n\nBug:\n${args.bug}`,
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
    const target = path.resolve(cwd, file)
    const exists = yield* Effect.promise(() => Bun.file(target).exists())
    if (!exists) return yield* fail(`The model reported ${file}, but that file does not exist.`)

    UI.println(`Test written: ${file}`)
    UI.println(`Running "${command}" to confirm it fails before the fix...`)
    const shell = process.platform === "win32" ? ["cmd", "/c", command] : ["sh", "-c", command]
    const run = yield* Effect.promise(async () => {
      const proc = Bun.spawn(shell, { cwd, stdout: "pipe", stderr: "pipe" })
      const [out, err] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()])
      const code = await proc.exited
      return { code, output: [out.trim(), err.trim()].filter(Boolean).join("\n") }
    })

    UI.empty()
    if (run.code === 0) {
      UI.println("The new test PASSES, so it does not reproduce the bug. Refine the description and rerun.")
      UI.println(`Kept for inspection: ${file}`)
      process.exitCode = 1
      return
    }

    UI.println(run.output.slice(-OUTPUT_LIMIT))
    UI.empty()
    UI.println(`The test fails as expected (exit ${run.code}). The regression is pinned down.`)
    UI.println(`Fix the bug, then prove it with: ${command}`)
  }),
})
