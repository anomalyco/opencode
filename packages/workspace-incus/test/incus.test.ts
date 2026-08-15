import { expect, test } from "bun:test"
import { Workspace } from "@opencode-ai/core/workspace"
import { Effect, Sink, Stream } from "effect"
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process"
import { ExitCode, makeHandle, ProcessId } from "effect/unstable/process/ChildProcessSpawner"
import { IncusWorkspace } from "../src"

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

test("copies a blueprint and manages the instance lifecycle", async () => {
  const commands: Array<ChildProcess.Command> = []
  const driver = IncusWorkspace.makeWith(host(commands), {
    remote: "IncusMini",
    project: "opencode",
    blueprint: "blueprint",
    user: 1000,
    group: 1000,
  })
  const workspaceID = Workspace.ID.create()
  const created = await Effect.runPromise(driver.create({ workspaceID }))

  expect(standard(commands[0]).args).toEqual([
    "copy",
    "IncusMini:blueprint",
    `IncusMini:opencode-${workspaceID.replaceAll("_", "-")}`,
    "--project",
    "opencode",
    "--target-project",
    "opencode",
    "--instance-only",
  ])
  expect(standard(commands[1]).args[0]).toBe("start")

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
          cwd: "/workspace/repo",
          env: { CI: "1", OMITTED: undefined },
        }),
      ),
    ),
  )
  const exec = standard(commands.at(-1)!)
  expect(exec.args).toEqual([
    "exec",
    `IncusMini:opencode-${workspaceID.replaceAll("_", "-")}`,
    "--project",
    "opencode",
    "--force-noninteractive",
    "--cwd",
    "/workspace/repo",
    "--user",
    "1000",
    "--group",
    "1000",
    "--env",
    "CI=1",
    "--",
    "git",
    "status",
    "--short",
  ])
  expect(exec.args.join(" ")).not.toContain("OMITTED")

  await Effect.runPromise(
    driver.suspendForIdle({
      workspaceID,
      binding: created.binding,
      saveBinding: (binding) => Effect.sync(() => saved.push(binding)),
    }),
  )
  expect(standard(commands.at(-1)!).args[0]).toBe("stop")
  expect(saved.at(-1)).toMatchObject({ state: "stopped" })

  await Effect.runPromise(driver.destroy({ workspaceID, binding: saved.at(-1)! }))
  expect(standard(commands.at(-1)!).args[0]).toBe("delete")
})

test("forks from the source workspace binding", async () => {
  const commands: Array<ChildProcess.Command> = []
  const driver = IncusWorkspace.makeWith(host(commands), {
    remote: "target",
    project: "target-project",
    blueprint: "unused",
  })
  const sourceID = Workspace.ID.create()
  await Effect.runPromise(
    driver.create({
      workspaceID: Workspace.ID.create(),
      source: {
        workspaceID: sourceID,
        binding: {
          version: 1,
          remote: "source",
          project: "source-project",
          instance: "source-instance",
          state: "running",
        },
      },
    }),
  )

  expect(standard(commands[0]).args.slice(0, 3)).toEqual(["snapshot", "create", "source:source-instance"])
  expect(standard(commands[1]).args.slice(0, 7)).toEqual([
    "copy",
    expect.stringMatching(/^source:source-instance\/opencode-fork-wrk-/),
    expect.stringMatching(/^target:opencode-wrk-/),
    "--project",
    "source-project",
    "--target-project",
    "target-project",
  ])
  expect(standard(commands[2]).args.slice(0, 3)).toEqual(["snapshot", "delete", "source:source-instance"])
})

test("removes a partial instance when startup fails", async () => {
  const commands: Array<ChildProcess.Command> = []
  const driver = IncusWorkspace.makeWith(host(commands, new Set(["start"])), {
    blueprint: "blueprint",
  })
  const result = await Effect.runPromiseExit(driver.create({ workspaceID: Workspace.ID.create() }))

  expect(result._tag).toBe("Failure")
  expect(commands.map((command) => standard(command).args[0])).toEqual(["copy", "start", "delete"])
})
