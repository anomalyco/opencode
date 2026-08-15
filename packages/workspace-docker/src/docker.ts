import { WorkspaceDriver } from "@opencode-ai/core/workspace/driver"
import { Effect, Stream } from "effect"
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process"

export interface Options {
  /** Immutable image produced by a blueprint build. Prefer a digest or versioned tag. */
  readonly snapshot: string
  readonly binary?: string
  readonly containerPrefix?: string
  readonly user?: string
  readonly network?: string
  readonly cpus?: number
  readonly memory?: string
}

interface Binding extends WorkspaceDriver.Binding {
  readonly version: 1
  readonly container: string
  readonly state: "running" | "stopped"
}

export const make = (options: Options) =>
  ChildProcessSpawner.ChildProcessSpawner.use((spawner) => Effect.succeed(makeWith(spawner, options)))

export const makeWith = (
  host: ChildProcessSpawner.ChildProcessSpawner["Service"],
  options: Options,
): WorkspaceDriver.Interface => {
  const binary = options.binary ?? "docker"
  const prefix = options.containerPrefix ?? "opencode-"

  const command = (args: ReadonlyArray<string>) => ChildProcess.make(binary, args)
  const run = Effect.fn("DockerWorkspace.run")(function* (args: ReadonlyArray<string>) {
    const result = yield* Effect.scoped(
      host.spawn(command(args)).pipe(
        Effect.flatMap((handle) =>
          Effect.all(
            {
              output: Stream.mkString(Stream.decodeText(handle.all)),
              code: handle.exitCode,
            },
            { concurrency: "unbounded" },
          ),
        ),
      ),
    ).pipe(
      Effect.mapError(
        (cause) => new WorkspaceDriver.Error({ message: `Failed to run ${binary} ${args.join(" ")}`, cause }),
      ),
    )
    if (Number(result.code) === 0) return result.output
    return yield* new WorkspaceDriver.Error({
      message: `${binary} ${args.join(" ")} exited with code ${result.code}: ${result.output.trim()}`,
    })
  })

  const start = (binding: Binding) =>
    run(["start", binding.container]).pipe(Effect.as({ ...binding, state: "running" } satisfies Binding))

  const parse = (value: WorkspaceDriver.Binding) => {
    const version = value.version
    const binding: Binding | undefined =
      version === 1 && typeof value.container === "string" && (value.state === "running" || value.state === "stopped")
        ? { version, container: value.container, state: value.state }
        : undefined
    return binding
      ? Effect.succeed(binding)
      : Effect.fail(new WorkspaceDriver.Error({ message: "Invalid Docker workspace binding" }))
  }

  const create = (container: string, snapshot: string, workspaceID: string) =>
    run([
      "create",
      "--name",
      container,
      "--label",
      `opencode.workspace=${workspaceID}`,
      "--init",
      ...(options.user ? ["--user", options.user] : []),
      ...(options.network ? ["--network", options.network] : []),
      ...(options.cpus === undefined ? [] : ["--cpus", String(options.cpus)]),
      ...(options.memory ? ["--memory", options.memory] : []),
      "--entrypoint",
      "/bin/sh",
      snapshot,
      "-c",
      "trap 'exit 0' TERM INT; while :; do sleep 3600; done",
    ])

  return WorkspaceDriver.make({
    create: ({ workspaceID, source }) =>
      Effect.gen(function* () {
        const container = `${prefix}${workspaceID.replaceAll("_", "-")}`
        const binding: Binding = { version: 1, container, state: "stopped" }
        const sourceBinding = source ? yield* parse(source.binding) : undefined
        const temporaryImage = sourceBinding ? `${container}-snapshot` : undefined
        if (sourceBinding && temporaryImage)
          yield* run(["commit", "--pause=true", sourceBinding.container, temporaryImage])
        yield* create(container, temporaryImage ?? options.snapshot, workspaceID).pipe(
          Effect.ensuring(
            temporaryImage ? run(["image", "rm", "--force", temporaryImage]).pipe(Effect.ignore) : Effect.void,
          ),
        )
        const running = yield* start(binding).pipe(
          Effect.onError(() => run(["rm", "--force", "--volumes", container]).pipe(Effect.ignore)),
        )
        return { binding: running }
      }),
    connect: ({ binding, saveBinding }) =>
      Effect.gen(function* () {
        const current = yield* parse(binding)
        const active = current.state === "running" ? current : yield* start(current)
        if (active !== current) yield* saveBinding(active)
        return {
          spawner: ChildProcessSpawner.make((input) => host.spawn(containerCommand(input, active, options))),
        }
      }),
    suspendForIdle: ({ binding, saveBinding }) =>
      Effect.gen(function* () {
        const current = yield* parse(binding)
        if (current.state === "stopped") return
        yield* run(["stop", "--time", "10", current.container])
        yield* saveBinding({ ...current, state: "stopped" } satisfies Binding)
      }),
    destroy: ({ binding }) =>
      Effect.gen(function* () {
        const current = yield* parse(binding)
        yield* run(["rm", "--force", "--volumes", current.container])
      }),
  })
}

const containerCommand = (command: ChildProcess.Command, binding: Binding, options: Options): ChildProcess.Command => {
  if (command._tag === "PipedCommand")
    return containerCommand(command.left, binding, options).pipe(
      ChildProcess.pipeTo(containerCommand(command.right, binding, options), command.options),
    )

  const environment = Object.entries(command.options.env ?? {}).flatMap(([key, value]) =>
    value === undefined ? [] : ["--env", `${key}=${value}`],
  )
  const executable = shellCommand(command)
  return ChildProcess.make(
    options.binary ?? "docker",
    [
      "exec",
      "--interactive",
      ...(command.options.cwd ? ["--workdir", command.options.cwd] : []),
      ...(options.user ? ["--user", options.user] : []),
      ...environment,
      binding.container,
      executable.command,
      ...executable.args,
    ],
    transportOptions(command.options),
  )
}

const shellCommand = (command: ChildProcess.StandardCommand) => {
  if (!command.options.shell) return { command: command.command, args: command.args }
  const shell = typeof command.options.shell === "string" ? command.options.shell : "/bin/sh"
  return {
    command: shell,
    args: ["-c", [command.command, ...command.args].map(shellQuote).join(" ")],
  }
}

const shellQuote = (value: string) => `'${value.replaceAll("'", `'"'"'`)}'`

const transportOptions = (options: ChildProcess.CommandOptions): ChildProcess.CommandOptions => ({
  detached: options.detached,
  stdin: options.stdin,
  stdout: options.stdout,
  stderr: options.stderr,
  killSignal: options.killSignal,
  forceKillAfter: options.forceKillAfter,
})
