#!/usr/bin/env bun
import * as NodeRuntime from "@effect/platform-node/NodeRuntime"
import * as NodeServices from "@effect/platform-node/NodeServices"
import { Effect, Option } from "effect"
import { Argument, Command, Flag } from "effect/unstable/cli"
import packageJson from "../../package.json" with { type: "json" }
import { extractCommands } from "./parse.js"
import { check } from "./check.js"
import { dir } from "./dir.js"
import { init } from "./init.js"
import { list } from "./list.js"
import { prune } from "./prune.js"
import { restart } from "./restart.js"
import { runProgram } from "./run.js"
import { send } from "./send.js"
import { initScript } from "./script-init.js"
import { start } from "./start.js"
import { stop } from "./stop.js"
import { logError } from "../log.js"
import type { DriveCommand, SendOptions, StartOptions } from "./types.js"

const extracted = extract()
const initName = Flag.string("name").pipe(
  Flag.withDescription("Instance name"),
)
const startName = Flag.string("name").pipe(
  Flag.optional,
  Flag.withDescription("Instance name (optional with --visible)"),
)
const name = Flag.string("name").pipe(
  Flag.optional,
  Flag.withDescription("Instance name (defaults to the visible instance)"),
)
const pruneName = Flag.string("name").pipe(
  Flag.optional,
  Flag.withDescription("Instance name"),
)

const initCommand = Command.make("init", { name: initName }, (config) =>
  execute(() => init(config.name)),
).pipe(
  Command.withDescription("Initialize an instance without launching OpenCode"),
  Command.withExamples([
    {
      command: "opencode-drive init --name demo",
      description: "Create an instance and print its artifact directory",
    },
  ]),
)

const checkCommand = Command.make(
  "check",
  { file: Argument.string("script") },
  (config) => execute(() => check(config.file)),
).pipe(
  Command.withDescription("Type-check an OpenCode Drive script"),
  Command.withExamples([
    {
      command: "opencode-drive check ./drive.ts",
      description: "Type-check a script with the bundled script API",
    },
  ]),
)

const scriptInitCommand = Command.make(
  "init",
  { file: Argument.string("file") },
  (config) => execute(() => initScript(config.file)),
).pipe(
  Command.withDescription("Create an Effect-native OpenCode Drive script"),
  Command.withExamples([
    {
      command: "opencode-drive script init ./drive.ts",
      description: "Create a type-checkable script without overwriting existing files",
    },
  ]),
)

const scriptCommand = Command.make("script").pipe(
  Command.withDescription("Create and manage OpenCode Drive scripts"),
  Command.withSubcommands([scriptInitCommand]),
)

const runCommand = Command.make(
  "run",
  { module: Argument.string("module") },
  (config) =>
    executeEffect(
      Effect.try({
        try: () => toRunModule(config.module, extracted.commands, extracted.app),
        catch: (error) => error,
      }).pipe(Effect.flatMap(runProgram), Effect.asVoid),
    ),
).pipe(
  Command.withDescription("Type-check and run a fully provided Effect program"),
  Command.withExamples([
    {
      command: "opencode-drive run ./drive.ts",
      description: "Run a default-exported Effect program",
    },
  ]),
)

const startCommand = Command.make(
  "start",
  {
    name: startName,
    daemon: Flag.boolean("daemon").pipe(
      Flag.withHidden,
      Flag.withDescription("Run as detached instance owner"),
    ),
    script: Flag.string("script").pipe(
      Flag.optional,
      Flag.withDescription("JavaScript or TypeScript automation module"),
    ),
    visible: Flag.boolean("visible").pipe(Flag.withDescription("Show OpenCode in the terminal")),
    record: Flag.boolean("record").pipe(
      Flag.withDescription("Record the complete headless session and export it on stop"),
    ),
    dev: Flag.string("dev").pipe(
      Flag.optional,
      Flag.withDescription("Path to an OpenCode development checkout"),
    ),
  },
  (config) =>
    executeEffect(
      Effect.try({
        try: () => toStartOptions(config, extracted.commands, extracted.app),
        catch: (error) => error,
      }).pipe(Effect.flatMap(start)),
    ),
).pipe(
  Command.withDescription("Launch a local simulated OpenCode instance"),
  Command.withExamples([
    {
      command: "opencode-drive start --name demo",
      description: "Launch headless OpenCode on the default ports",
    },
    {
      command: "opencode-drive start --visible",
      description: "Launch visible OpenCode on the default ports",
    },
    {
      command: "opencode-drive start --name demo --script ./drive.ts",
      description: "Launch headless OpenCode and run a script",
    },
  ]),
)

const sendCommand = Command.make("send", { name }, (config) =>
  execute(() =>
    send(toSendOptions(Option.getOrUndefined(config.name), extracted.commands, extracted.app)),
  ),
).pipe(
  Command.withDescription("Send UI commands to OpenCode on the default port"),
  Command.withExamples([
    {
      command: 'opencode-drive send --command.ui.type \'{"text":"hello"}\' --command.ui.state',
      description: "Execute an ordered UI command batch",
    },
  ]),
)

const restartCommand = Command.make("restart", { name }, (config) =>
  execute(() => restart(Option.getOrUndefined(config.name))),
).pipe(Command.withDescription("Restart a named OpenCode instance and rerun its script"))

const stopCommand = Command.make("stop", { name }, (config) =>
  execute(() => stop(Option.getOrUndefined(config.name))),
).pipe(Command.withDescription("Stop a named OpenCode instance"))

const dirCommand = Command.make("dir", { name }, (config) =>
  execute(() => dir(Option.getOrUndefined(config.name))),
).pipe(Command.withDescription("Print the artifact directory for a named OpenCode instance"))

const listCommand = Command.make("list", {}, () => execute(list)).pipe(
  Command.withDescription("List active OpenCode instances"),
)

const pruneCommand = Command.make(
  "prune",
  {
    name: pruneName,
    force: Flag.boolean("force").pipe(
      Flag.withDescription("Delete all matching artifact directories, including active ones"),
    ),
  },
  (config) =>
    execute(() =>
      prune({ name: Option.getOrUndefined(config.name), force: config.force }),
    ),
).pipe(
  Command.withDescription("Delete artifact directories for inactive OpenCode instances"),
)

const root = Command.make("opencode-drive").pipe(
  Command.withDescription("Drive real and simulated OpenCode instances"),
  Command.withSubcommands([
    initCommand,
    scriptCommand,
    checkCommand,
    runCommand,
    startCommand,
    sendCommand,
    listCommand,
    pruneCommand,
    dirCommand,
    restartCommand,
    stopCommand,
  ]),
)

Command.runWith(root, { version: packageJson.version })(extracted.args).pipe(
  Effect.provide(NodeServices.layer),
  NodeRuntime.runMain,
)

function toStartOptions(
  config: {
    readonly script: Option.Option<string>
    readonly name: Option.Option<string>
    readonly daemon: boolean
    readonly visible: boolean
    readonly record: boolean
    readonly dev: Option.Option<string>
  },
  commands: ReadonlyArray<DriveCommand>,
  app: ReadonlyArray<string>,
): StartOptions {
  if (commands.length > 0)
    throw new Error("start does not accept command flags; use send or --script")
  const name = Option.getOrUndefined(config.name)
  if (name === undefined && !config.visible)
    throw new Error("start requires --name unless --visible is passed")
  const options = {
    kind: "start" as const,
    name: name ?? `visible-${process.pid}`,
    daemon: config.daemon,
    script: Option.getOrUndefined(config.script),
    visible: config.visible,
    record: config.record,
    dev: Option.getOrUndefined(config.dev),
    command: app,
  }
  if (options.dev !== undefined && app.length > 0)
    throw new Error("--dev cannot be combined with a command after --")
  return options
}

function toRunModule(
  module: string,
  commands: ReadonlyArray<DriveCommand>,
  app: ReadonlyArray<string>,
) {
  if (commands.length > 0)
    throw new Error("run does not accept command flags")
  if (app.length > 0)
    throw new Error("run does not accept arguments after --")
  return module
}

function toSendOptions(
  name: string | undefined,
  commands: ReadonlyArray<DriveCommand>,
  app: ReadonlyArray<string>,
): SendOptions {
  if (app.length > 0) throw new Error("send does not accept a command after --")
  return { kind: "send", name, commands }
}

function execute(task: () => Promise<void>) {
  return executeEffect(Effect.tryPromise({ try: task, catch: (error) => error }))
}

function executeEffect<R>(task: Effect.Effect<void, unknown, R>) {
  return task.pipe(
    Effect.catch((error) =>
      Effect.sync(() => {
        logError(error instanceof Error ? error.message : String(error))
        process.exitCode = 1
      }),
    ),
  )
}

function extract() {
  try {
    return extractCommands(process.argv.slice(2))
  } catch (error) {
    logError(error instanceof Error ? error.message : String(error))
    return process.exit(1)
  }
}
