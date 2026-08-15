import { WorkspaceDriver } from "@opencode-ai/core/workspace/driver"
import { Effect, Stream } from "effect"
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process"

export interface Options {
  readonly blueprint: string
  readonly remote?: string
  readonly project?: string
  readonly blueprintRemote?: string
  readonly blueprintProject?: string
  readonly binary?: string
  readonly instancePrefix?: string
  readonly user?: number
  readonly group?: number
}

interface Binding extends WorkspaceDriver.Binding {
  readonly version: 1
  readonly remote: string
  readonly project: string
  readonly instance: string
  readonly state: "running" | "stopped"
}

export const make = (options: Options) =>
  ChildProcessSpawner.ChildProcessSpawner.use((spawner) => Effect.succeed(makeWith(spawner, options)))

export const makeWith = (
  host: ChildProcessSpawner.ChildProcessSpawner["Service"],
  options: Options,
): WorkspaceDriver.Interface => {
  const binary = options.binary ?? "incus"
  const remote = options.remote ?? "local"
  const project = options.project ?? "default"
  const blueprintRemote = options.blueprintRemote ?? remote
  const blueprintProject = options.blueprintProject ?? project
  const prefix = options.instancePrefix ?? "opencode-"

  const command = (args: ReadonlyArray<string>) => ChildProcess.make(binary, args)
  const run = Effect.fn("IncusWorkspace.run")(function* (args: ReadonlyArray<string>) {
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

  const lifecycle = (operation: string, binding: Binding, extra: ReadonlyArray<string> = []) =>
    run([operation, `${binding.remote}:${binding.instance}`, "--project", binding.project, ...extra])

  const start = (binding: Binding) =>
    lifecycle("start", binding).pipe(Effect.as({ ...binding, state: "running" } satisfies Binding))

  const parse = (value: WorkspaceDriver.Binding) => {
    const version = value.version
    const binding: Binding | undefined =
      version === 1 &&
      typeof value.remote === "string" &&
      typeof value.project === "string" &&
      typeof value.instance === "string" &&
      (value.state === "running" || value.state === "stopped")
        ? {
            version,
            remote: value.remote,
            project: value.project,
            instance: value.instance,
            state: value.state,
          }
        : undefined
    return binding
      ? Effect.succeed(binding)
      : Effect.fail(new WorkspaceDriver.Error({ message: "Invalid Incus workspace binding" }))
  }

  return WorkspaceDriver.make({
    create: ({ workspaceID, source }) =>
      Effect.gen(function* () {
        const instance = `${prefix}${workspaceID.replaceAll("_", "-")}`
        const sourceBinding = source ? yield* parse(source.binding) : undefined
        const sourceRemote = sourceBinding?.remote ?? blueprintRemote
        const sourceProject = sourceBinding?.project ?? blueprintProject
        const binding: Binding = { version: 1, remote, project, instance, state: "stopped" }
        const copy = (sourceInstance: string) =>
          run([
            "copy",
            `${sourceRemote}:${sourceInstance}`,
            `${remote}:${instance}`,
            "--project",
            sourceProject,
            "--target-project",
            project,
            "--instance-only",
          ])
        if (!sourceBinding) yield* copy(options.blueprint)
        if (sourceBinding) {
          const snapshot = `opencode-fork-${workspaceID.replaceAll("_", "-")}`
          yield* run([
            "snapshot",
            "create",
            `${sourceRemote}:${sourceBinding.instance}`,
            snapshot,
            "--project",
            sourceProject,
            "--no-expiry",
          ])
          yield* copy(`${sourceBinding.instance}/${snapshot}`).pipe(
            Effect.ensuring(
              run([
                "snapshot",
                "delete",
                `${sourceRemote}:${sourceBinding.instance}`,
                snapshot,
                "--project",
                sourceProject,
              ]).pipe(Effect.ignore),
            ),
          )
        }
        const running = yield* start(binding).pipe(
          Effect.onError(() => lifecycle("delete", binding, ["--force"]).pipe(Effect.ignore)),
        )
        return { binding: running }
      }),
    connect: ({ binding, saveBinding }) =>
      Effect.gen(function* () {
        const current = yield* parse(binding)
        const active = current.state === "running" ? current : yield* start(current)
        if (active !== current) yield* saveBinding(active)
        return {
          spawner: ChildProcessSpawner.make((input) => host.spawn(remoteCommand(input, active, options))),
        }
      }),
    suspendForIdle: ({ binding, saveBinding }) =>
      Effect.gen(function* () {
        const current = yield* parse(binding)
        if (current.state === "stopped") return
        yield* lifecycle("stop", current, ["--force"])
        yield* saveBinding({ ...current, state: "stopped" } satisfies Binding)
      }),
    destroy: ({ binding }) =>
      Effect.gen(function* () {
        const current = yield* parse(binding)
        yield* lifecycle("delete", current, ["--force"])
      }),
  })
}

const remoteCommand = (command: ChildProcess.Command, binding: Binding, options: Options): ChildProcess.Command => {
  if (command._tag === "PipedCommand")
    return remoteCommand(command.left, binding, options).pipe(
      ChildProcess.pipeTo(remoteCommand(command.right, binding, options), command.options),
    )

  const environment = Object.entries(command.options.env ?? {}).flatMap(([key, value]) =>
    value === undefined ? [] : ["--env", `${key}=${value}`],
  )
  const identity = [
    ...(options.user === undefined ? [] : ["--user", String(options.user)]),
    ...(options.group === undefined ? [] : ["--group", String(options.group)]),
  ]
  const executable = shellCommand(command)
  return ChildProcess.make(
    options.binary ?? "incus",
    [
      "exec",
      `${binding.remote}:${binding.instance}`,
      "--project",
      binding.project,
      "--force-noninteractive",
      ...(command.options.cwd ? ["--cwd", command.options.cwd] : []),
      ...identity,
      ...environment,
      "--",
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
