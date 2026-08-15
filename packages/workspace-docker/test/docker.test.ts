import { expect, test } from "bun:test"
import { Workspace } from "@opencode-ai/core/workspace"
import { Effect, Sink, Stream } from "effect"
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process"
import { ExitCode, makeHandle, ProcessId } from "effect/unstable/process/ChildProcessSpawner"
import { DockerWorkspace } from "../src"

const text = new TextEncoder()

const host = (commands: Array<ChildProcess.Command>, failures: Set<string> = new Set()) =>
  ChildProcessSpawner.make((command) => {
    commands.push(command)
    const operation = command._tag === "StandardCommand" ? command.args[0] : "pipeline"
    const code = failures.has(operation ?? "") ? 1 : 0
    const output = code === 0 ? new Uint8Array() : text.encode(`${operation} failed`)
    return Effect.succeed(
      makeHandle({
        pid: ProcessId(commands.length),
        exitCode: Effect.succeed(ExitCode(code)),
        isRunning: Effect.succeed(false),
        kill: () => Effect.void,
        stdin: Sink.drain,
        stdout: Stream.empty,
        stderr: Stream.empty,
        all: output.length === 0 ? Stream.empty : Stream.make(output),
        getInputFd: () => Sink.drain,
        getOutputFd: () => Stream.empty,
        unref: Effect.succeed(Effect.void),
      }),
    )
  })

const standard = (command: ChildProcess.Command) => {
  expect(command._tag).toBe("StandardCommand")
  if (command._tag !== "StandardCommand") throw new Error("Expected a standard command")
  return command
}

test("creates a workspace from the immutable snapshot and manages its lifecycle", async () => {
  const commands: Array<ChildProcess.Command> = []
  const driver = DockerWorkspace.makeWith(host(commands), {
    snapshot: "blueprint-snapshot:v1",
    user: "1000:1000",
    cpus: 4,
    memory: "8g",
  })
  const workspaceID = Workspace.ID.create()
  const created = await Effect.runPromise(driver.create({ workspaceID }))
  const container = `opencode-${workspaceID.replaceAll("_", "-")}`

  expect(standard(commands[0]).args).toEqual([
    "create",
    "--name",
    container,
    "--label",
    `opencode.workspace=${workspaceID}`,
    "--init",
    "--user",
    "1000:1000",
    "--cpus",
    "4",
    "--memory",
    "8g",
    "--entrypoint",
    "/bin/sh",
    "blueprint-snapshot:v1",
    "-c",
    "trap 'exit 0' TERM INT; while :; do sleep 3600; done",
  ])
  expect(standard(commands[1]).args).toEqual(["start", container])

  const saved: Array<Record<string, unknown>> = []
  const environment = await Effect.runPromise(
    Effect.scoped(
      driver.connect({
        workspaceID,
        binding: created.binding,
        saveBinding: (binding) => Effect.sync(() => saved.push(binding)),
      }),
    ),
  )
  await Effect.runPromise(
    Effect.scoped(
      environment.spawner.spawn(
        ChildProcess.make("git", ["status", "--short"], {
          cwd: "/workspace",
          env: { CI: "1", OMITTED: undefined },
        }),
      ),
    ),
  )
  expect(standard(commands.at(-1)!).args).toEqual([
    "exec",
    "--interactive",
    "--workdir",
    "/workspace",
    "--user",
    "1000:1000",
    "--env",
    "CI=1",
    container,
    "git",
    "status",
    "--short",
  ])

  await Effect.runPromise(
    driver.suspendForIdle({
      workspaceID,
      binding: created.binding,
      saveBinding: (binding) => Effect.sync(() => saved.push(binding)),
    }),
  )
  expect(standard(commands.at(-1)!).args).toEqual(["stop", "--time", "10", container])
  expect(saved.at(-1)).toMatchObject({ state: "stopped" })

  await Effect.runPromise(driver.destroy({ workspaceID, binding: saved.at(-1)! }))
  expect(standard(commands.at(-1)!).args).toEqual(["rm", "--force", "--volumes", container])
})

test("forks through a paused commit and removes the temporary image", async () => {
  const commands: Array<ChildProcess.Command> = []
  const driver = DockerWorkspace.makeWith(host(commands), { snapshot: "unused" })
  await Effect.runPromise(
    driver.create({
      workspaceID: Workspace.ID.create(),
      source: {
        workspaceID: Workspace.ID.create(),
        binding: { version: 1, container: "source-container", state: "running" },
      },
    }),
  )

  expect(standard(commands[0]).args).toEqual([
    "commit",
    "--pause=true",
    "source-container",
    expect.stringMatching(/^opencode-wrk-.*-snapshot$/),
  ])
  expect(standard(commands[1]).args[0]).toBe("create")
  expect(standard(commands[2]).args).toEqual([
    "image",
    "rm",
    "--force",
    expect.stringMatching(/^opencode-wrk-.*-snapshot$/),
  ])
  expect(standard(commands[3]).args[0]).toBe("start")
})

test("removes a partial container when startup fails", async () => {
  const commands: Array<ChildProcess.Command> = []
  const driver = DockerWorkspace.makeWith(host(commands, new Set(["start"])), { snapshot: "blueprint-snapshot:v1" })
  const result = await Effect.runPromiseExit(driver.create({ workspaceID: Workspace.ID.create() }))

  expect(result._tag).toBe("Failure")
  expect(commands.map((command) => standard(command).args[0])).toEqual(["create", "start", "rm"])
})
