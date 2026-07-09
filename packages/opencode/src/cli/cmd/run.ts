import { Effect } from "effect"
import { effectCmd } from "../effect-cmd"
import { v2ServerCommand } from "./v2-server-command"

export const RunCommand = effectCmd({
  command: "run [message..]",
  describe: "run opencode with a message",
  instance: false,
  builder: (yargs) =>
    yargs
      .positional("message", {
        describe: "message to send",
        type: "string",
        array: true,
        default: [],
      })
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
        describe: "fork the session before continuing (requires --continue or --session)",
        type: "boolean",
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
      .option("format", {
        type: "string",
        choices: ["default", "json"] as const,
        default: "default" as const,
        describe: "format: default (formatted) or json (raw JSON events)",
      })
      .option("file", {
        alias: ["f"],
        type: "string",
        array: true,
        describe: "file(s) to attach to message",
      })
      .option("title", {
        type: "string",
        describe: "title for the session (uses truncated prompt if no value provided)",
      })
      .option("server", {
        type: "string",
        describe: "connect to a running opencode server",
      })
      .option("attach", {
        type: "string",
        hidden: true,
      })
      .option("password", {
        alias: ["p"],
        type: "string",
        hidden: true,
      })
      .option("username", {
        alias: ["u"],
        type: "string",
        hidden: true,
      })
      .option("dir", {
        type: "string",
        describe: "directory to run in, or a path on the remote server",
      })
      .option("variant", {
        type: "string",
        describe: "model variant",
      })
      .option("thinking", {
        type: "boolean",
        describe: "show thinking blocks",
      })
      .option("auto", {
        type: "boolean",
        describe: "auto-approve permissions that are not explicitly denied (dangerous!)",
        default: false,
      })
      .option("yolo", {
        type: "boolean",
        hidden: true,
        default: false,
      })
      .option("dangerously-skip-permissions", {
        type: "boolean",
        hidden: true,
        default: false,
      }),
  handler: Effect.fn("Cli.run")(function* (args) {
    const { runNonInteractive } = yield* Effect.promise(() => import("@opencode-ai/cli/mini"))
    yield* Effect.promise(() =>
      runNonInteractive({
        message: [...args.message, ...(args["--"] || [])],
        continue: args.continue,
        session: args.session,
        fork: args.fork,
        model: args.model,
        agent: args.agent,
        format: args.format,
        file: args.file ?? [],
        title: args.title,
        server: args.server ?? args.attach,
        // @ts-expect-error V1 does not consume the V2-only resolved server input.
        password: args.password ?? process.env.OPENCODE_PASSWORD ?? process.env.OPENCODE_SERVER_PASSWORD,
        username: args.username ?? process.env.OPENCODE_SERVER_USERNAME,
        directory: args.dir,
        variant: args.variant,
        thinking: args.thinking,
        dangerouslySkipPermissions: args.auto || args.yolo || args["dangerously-skip-permissions"],
        standaloneCommand: args.server || args.attach ? undefined : v2ServerCommand(),
      }),
    )
  }),
})
