import { NodeServices } from "@effect/platform-node"
import { Global } from "@opencode/util/global"
import { expect, spyOn, test } from "bun:test"
import { Effect } from "effect"
import { Command } from "effect/cli"
import { Commands } from "../../src/commands/commands"
import handler from "../../src/commands/handlers/run"
import { ServerConnection } from "../../src/services/server-connection"

test.each([
  { args: ["--", "marker"], message: ["marker"] },
  { args: ["prefix", "--", "one", "two"], message: ["prefix", "one", "two"] },
])("run forwards arguments after -- once: $args", async ({ args, message }) => {
  const run = await import("../../src/run/run")
  const submit = spyOn(run, "runNonInteractive").mockResolvedValue(undefined)
  const connection = spyOn(ServerConnection, "resolve").mockReturnValue(
    Effect.succeed({ endpoint: { url: "http://opencode.test", auth: undefined } }),
  )
  const argv = process.argv
  process.argv = [process.execPath, "opencode", "run", ...args]
  try {
    await Effect.runPromise(
      Command.runWith(Commands.commands.run.spec.pipe(Command.withHandler(handler)), { version: "test" })(args).pipe(
        Effect.provideService(Global.Service, Global.make()),
        Effect.provide(NodeServices.layer),
        Effect.scoped,
      ),
    )
    expect(submit).toHaveBeenCalledTimes(1)
    expect(submit.mock.calls[0]?.[0].message).toEqual([...message])
  } finally {
    process.argv = argv
    connection.mockRestore()
    submit.mockRestore()
  }
})
