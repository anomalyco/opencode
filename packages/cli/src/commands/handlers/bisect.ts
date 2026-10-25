import { Effect } from "effect"
import { UI } from "../ui"
import { effectCmd, fail } from "../effect-cmd"

const DIFF_LIMIT = 40_000
const OUTPUT_LIMIT = 10_000

const INSTRUCTIONS = [
  "Main is red. A git bisect identified the culprit commit below.",
  "Investigate with your read, grep, and glob tools, explain the root cause in two or three sentences, and propose the minimal fix as a unified diff in a fenced code block.",
  "Do not edit any files; only propose the patch.",
].join("\n")

export const BisectCommand = effectCmd({
  command: "bisect <command>",
  describe: "find the commit that broke a command, show blame, and propose a fix",
  builder: (yargs) =>
    yargs
      .positional("command", {
        type: "string",
        demandOption: true,
        describe: 'command that fails on HEAD, e.g. "bun test ./test/foo.test.ts"',
      })
      .option("good", {
        alias: "g",
        type: "string",
        demandOption: true,
        describe: "a ref where the command still passed, e.g. origin/dev~20",
      })
      .option("fix", {
        type: "boolean",
        default: false,
        describe: "ask the agent to analyze the culprit and propose a patch",
      })
      .option("model", {
        alias: "m",
        type: "string",
        describe: "model to use for the fix proposal in the format of provider/model",
      }),
  handler: Effect.fn("Cli.bisect")(function* (args) {
    const { InstanceRef } = yield* Effect.promise(() => import("@/effect/instance-ref"))
    const { Git } = yield* Effect.promise(() => import("@/git"))
    const ctx = yield* InstanceRef
    if (!ctx) return yield* fail("Could not load instance context")
    if (ctx.project.vcs !== "git") {
      return yield* fail("Could not find git repository. Please run this command from a git repository.")
    }
    const git = yield* Git.Service
    const cwd = ctx.worktree
    const command = args.command
    const shell = process.platform === "win32" ? ["cmd", "/c", command] : ["sh", "-c", command]

    const execute = () =>
      Effect.promise(async () => {
        const proc = Bun.spawn(shell, { cwd, stdout: "pipe", stderr: "pipe" })
        const [out, err] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()])
        const code = await proc.exited
        return { code, output: [out.trim(), err.trim()].filter(Boolean).join("\n") }
      })

    UI.println(`Checking that "${command}" fails on HEAD...`)
    const head = yield* execute()
    if (head.code === 0) return yield* fail("The command passes on HEAD. Nothing to bisect.")

    UI.println(`Bisecting between ${args.good} (good) and HEAD (bad)...`)
    const start = yield* git.run(["bisect", "start", "HEAD", args.good], { cwd })
    if (start.exitCode !== 0) {
      yield* git.run(["bisect", "reset"], { cwd })
      return yield* fail(start.stderr.toString().trim() || "git bisect start failed")
    }

    const run = yield* git.run(["bisect", "run", ...shell], { cwd })
    const culprit = yield* git.run(["rev-parse", "refs/bisect/bad"], { cwd })
    if (run.exitCode !== 0 || culprit.exitCode !== 0) {
      yield* git.run(["bisect", "reset"], { cwd })
      return yield* fail(run.stderr.toString().trim() || "git bisect run failed to converge")
    }
    const sha = culprit.text().trim()

    const summary = yield* git.run(
      ["show", "--stat", "--format=commit %H%nauthor %an <%ae>%ndate   %ad%n%n  %s", sha],
      {
        cwd,
      },
    )
    const diff = yield* git.run(["show", sha], { cwd })
    const signed = yield* git.run(["log", "-1", "--format=%h%x00%G?%x00%GS", sha], { cwd })
    yield* git.run(["bisect", "reset"], { cwd })

    UI.empty()
    UI.println("Culprit found:")
    UI.println(summary.text().trim())
    const { Signature } = yield* Effect.promise(() => import("./signature"))
    const entry = Signature.parse(signed.text()).at(0)
    if (entry) UI.println(Signature.line(entry))
    UI.empty()

    if (!args.fix) {
      UI.println(`Propose a fix with: bolt bisect "${command}" --good ${args.good} --fix`)
      return
    }

    UI.println("Asking the agent for a root cause and a proposed patch...")
    const { Session } = yield* Effect.promise(() => import("@/session/session"))
    const { SessionPrompt } = yield* Effect.promise(() => import("@/session/prompt"))
    const { MessageID, PartID } = yield* Effect.promise(() => import("../../session/schema"))
    const { parseModel } = yield* Effect.promise(() => import("@/provider/provider"))
    const { extractResponseText } = yield* Effect.promise(() => import("./github.shared"))
    const sessions = yield* Session.Service
    const prompt = yield* SessionPrompt.Service
    const session = yield* sessions.create({
      title: `bolt bisect: ${command}`,
      permission: [
        { permission: "question", action: "deny", pattern: "*" },
        { permission: "plan_enter", action: "deny", pattern: "*" },
        { permission: "plan_exit", action: "deny", pattern: "*" },
      ],
    })

    const patch = diff.text().slice(0, DIFF_LIMIT)
    const output = head.output.slice(-OUTPUT_LIMIT)
    const result = yield* prompt
      .prompt({
        sessionID: session.id,
        messageID: MessageID.ascending(),
        model: args.model ? parseModel(args.model) : undefined,
        parts: [
          {
            id: PartID.ascending(),
            type: "text",
            text: `${INSTRUCTIONS}\n\nFailing command: ${command}\n\nFailure output:\n${output}\n\nCulprit commit:\n${patch}`,
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
    if (!text) return yield* fail("The model returned an empty proposal.")
    UI.empty()
    UI.println(UI.markdown(text))
  }),
})
