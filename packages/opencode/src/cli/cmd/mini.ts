import type { Argv } from "yargs"
import { cmd } from "./cmd"
import { UI } from "@/cli/ui"
import { resolveThreadDirectory } from "./tui"

type ReplayArgs = {
  replay?: boolean
  noReplay?: boolean
}

type MiniArgs = ReplayArgs & {
  continue?: boolean
  session?: string
  fork?: boolean
  replayLimit?: number
}

type MiniLocalArgs = MiniArgs & {
  project?: string
  model?: string
  agent?: string
  prompt?: string
  demo?: boolean
}

type MiniAttachArgs = MiniArgs & {
  url: string
  dir?: string
  password?: string
  username?: string
}

function replay(args: ReplayArgs) {
  if (args.replay === true) {
    UI.error("--replay is not supported; replay is enabled by default")
    process.exitCode = 1
    return "invalid" as const
  }
  return args.replay === false || args.noReplay === true ? false : undefined
}

function miniOptions<T>(yargs: Argv<T>) {
  return yargs
    .option("continue", {
      alias: ["c"],
      describe: "continue the last session",
      type: "boolean",
    })
    .option("session", {
      alias: ["s"],
      describe: "session id to continue",
      type: "string",
    })
    .option("fork", {
      type: "boolean",
      describe: "fork the session when continuing (use with --continue or --session)",
    })
    .option("replay", {
      type: "boolean",
      hidden: true,
    })
    .option("no-replay", {
      type: "boolean",
      describe: "disable session history replay on resume and after resize",
    })
    .option("replay-limit", {
      type: "number",
      describe: "cap visible replay to the newest N messages",
    })
}

/** @internal Exported for CLI parser tests. */
export const MiniLocalCommand = cmd<{}, MiniLocalArgs>({
  command: "$0 [project]",
  describe: "start the minimal interactive interface",
  builder: (yargs) =>
    miniOptions(
      yargs
        .positional("project", {
          type: "string",
          describe: "path to start opencode in",
        })
        .option("model", {
          type: "string",
          alias: ["m"],
          describe: "model to use in the format of provider/model",
        })
        .option("agent", {
          type: "string",
          describe: "agent to use",
        })
        .option("prompt", {
          type: "string",
          describe: "prompt to use",
        })
        .option("demo", {
          type: "boolean",
          hidden: true,
        }),
    ),
  handler: async (args) => {
    const shouldReplay = replay(args)
    if (shouldReplay === "invalid") return

    const { runMini } = await import("./run")
    await runMini({
      directory: resolveThreadDirectory(args.project),
      continue: args.continue,
      session: args.session,
      fork: args.fork,
      model: args.model,
      agent: args.agent,
      prompt: args.prompt,
      replay: shouldReplay,
      replayLimit: args.replayLimit,
      demo: args.demo,
    })
  },
})

/** @internal Exported for CLI parser tests. */
export const MiniAttachCommand = cmd<{}, MiniAttachArgs>({
  command: "attach <url>",
  describe: "attach to a running opencode server with the minimal interface",
  builder: (yargs) =>
    miniOptions(
      yargs
        .positional("url", {
          type: "string",
          describe: "http://localhost:4096",
          demandOption: true,
        })
        .option("dir", {
          type: "string",
          describe: "directory on the remote server",
        })
        .option("password", {
          alias: ["p"],
          type: "string",
          describe: "basic auth password (defaults to OPENCODE_SERVER_PASSWORD)",
        })
        .option("username", {
          alias: ["u"],
          type: "string",
          describe: "basic auth username (defaults to OPENCODE_SERVER_USERNAME or 'opencode')",
        }),
    ),
  handler: async (args) => {
    const shouldReplay = replay(args)
    if (shouldReplay === "invalid") return

    const { runMini } = await import("./run")
    await runMini({
      attach: args.url,
      directory: args.dir,
      password: args.password,
      username: args.username,
      continue: args.continue,
      session: args.session,
      fork: args.fork,
      replay: shouldReplay,
      replayLimit: args.replayLimit,
    })
  },
})

export const MiniCommand = cmd({
  command: "mini",
  describe: "start the minimal interactive interface",
  builder: (yargs) => yargs.command(MiniLocalCommand).command(MiniAttachCommand).demandCommand(),
  handler: async () => {},
})
