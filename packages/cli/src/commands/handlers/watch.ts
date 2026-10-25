import fs from "fs"
import { Effect } from "effect"
import { UI } from "../ui"
import { effectCmd, fail } from "../effect-cmd"

const OUTPUT_LIMIT = 20_000
const SETTLE_MS = 200
const SKIPPED = new Set([".git", "node_modules", "dist", "build", ".turbo", ".cache"])

/** Whether a changed path should trigger a rerun. */
export function relevant(file: string) {
  return !file
    .replaceAll("\\", "/")
    .split("/")
    .some((segment) => SKIPPED.has(segment))
}

const INSTRUCTIONS = [
  "The following command failed. Investigate the failure, then fix the underlying code or test using your tools.",
  "Do not skip, delete, or weaken tests to make them pass unless the test itself is clearly wrong.",
  "Keep the change minimal and consistent with the surrounding code.",
].join("\n")

export const WatchCommand = effectCmd({
  command: "watch <command>",
  describe: "rerun a command on every file change, optionally fixing failures with the agent",
  builder: (yargs) =>
    yargs
      .positional("command", {
        type: "string",
        demandOption: true,
        describe: 'command to run when files change, e.g. "bun test"',
      })
      .option("fix", {
        type: "boolean",
        default: false,
        describe: "send failures to the agent so it can fix them",
      })
      .option("attempts", {
        type: "number",
        default: 3,
        describe: "max consecutive fix attempts before waiting for a manual change",
      })
      .option("model", {
        alias: "m",
        type: "string",
        describe: "model to use for fixes in the format of provider/model",
      }),
  handler: Effect.fn("Cli.watch")(function* (args) {
    const { InstanceRef } = yield* Effect.promise(() => import("@/effect/instance-ref"))
    const ctx = yield* InstanceRef
    if (!ctx) return yield* fail("Could not load instance context")
    const cwd = ctx.worktree
    const command = args.command

    const { Session } = yield* Effect.promise(() => import("@/session/session"))
    const { SessionPrompt } = yield* Effect.promise(() => import("@/session/prompt"))
    const { MessageID, PartID } = yield* Effect.promise(() => import("../../session/schema"))
    const { parseModel } = yield* Effect.promise(() => import("@/provider/provider"))
    const sessions = yield* Session.Service
    const prompt = yield* SessionPrompt.Service

    let dirty = false
    let notify: (() => void) | undefined
    const watcher = fs.watch(cwd, { recursive: true }, (_, name) => {
      if (name && !relevant(name)) return
      dirty = true
      notify?.()
    })
    const wait = () =>
      new Promise<void>((resolve) => {
        if (dirty) return resolve()
        notify = resolve
      })
    const settle = () => new Promise<void>((resolve) => setTimeout(resolve, SETTLE_MS))

    const execute = async () => {
      const shell = process.platform === "win32" ? ["cmd", "/c", command] : ["sh", "-c", command]
      const proc = Bun.spawn(shell, { cwd, stdout: "pipe", stderr: "pipe" })
      const [out, err] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()])
      const code = await proc.exited
      const output = [out.trim(), err.trim()].filter(Boolean).join("\n")
      return { code, output }
    }

    let sessionID: Effect.Success<ReturnType<typeof sessions.create>>["id"] | undefined
    const repair = Effect.fn("Cli.watch.fix")(function* (output: string) {
      if (!sessionID) {
        const session = yield* sessions.create({
          title: `bolt watch: ${command}`,
          permission: [
            { permission: "question", action: "deny", pattern: "*" },
            { permission: "plan_enter", action: "deny", pattern: "*" },
            { permission: "plan_exit", action: "deny", pattern: "*" },
          ],
        })
        sessionID = session.id
      }
      const tail = output.length > OUTPUT_LIMIT ? output.slice(-OUTPUT_LIMIT) : output
      const result = yield* prompt
        .prompt({
          sessionID,
          messageID: MessageID.ascending(),
          model: args.model ? parseModel(args.model) : undefined,
          parts: [
            {
              id: PartID.ascending(),
              type: "text",
              text: `${INSTRUCTIONS}\n\nCommand: ${command}\n\nOutput:\n${tail}`,
            },
          ],
        })
        .pipe(Effect.orDie)
      if (result.info.role === "assistant" && result.info.error) {
        const err = result.info.error
        const message = "message" in err.data ? err.data.message : ""
        UI.error(`fix attempt failed: ${err.name}: ${message}`)
      }
    })

    UI.println(`Watching ${cwd}`)
    UI.println(`Running "${command}" on every change. Press ctrl+c to stop.`)

    let failures = 0
    const loop = Effect.gen(function* () {
      while (true) {
        dirty = false
        notify = undefined
        const result = yield* Effect.promise(execute)
        if (result.output) UI.println(result.output)
        UI.empty()
        if (result.code === 0) {
          failures = 0
          UI.println(`Passed. Waiting for changes...`)
        }
        if (result.code !== 0) {
          failures++
          UI.println(`Failed with exit code ${result.code}.`)
          if (args.fix && failures <= args.attempts) {
            UI.println(`Asking the agent to fix it (attempt ${failures}/${args.attempts})...`)
            yield* repair(result.output)
            dirty = true
          }
          if (args.fix && failures > args.attempts) {
            UI.println(`Giving up after ${args.attempts} fix attempts. Waiting for a manual change...`)
          }
          if (!args.fix) UI.println(`Waiting for changes...`)
        }
        yield* Effect.promise(wait)
        yield* Effect.promise(settle)
      }
    })

    yield* loop.pipe(Effect.ensuring(Effect.sync(() => watcher.close())))
  }),
})
