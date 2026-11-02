import { expect, test } from "bun:test"
import { SandboxDiagnostics } from "../src/sandbox/diagnostics"
import { AppProcess } from "@opencode/util/process"
import { Effect, Layer } from "effect"
import { SandboxCheck } from "../src/sandbox/check"
import { it } from "./lib/effect"

test("sandbox hints distinguish loader, profile and possible permission failures without treating arbitrary exits as denials", () => {
  expect(SandboxDiagnostics.hint("dyld[123]: Library not loaded: /external/libPython")).toContain(
    "Runtime loader failure",
  )
  expect(SandboxDiagnostics.hint("sandbox-exec: sandbox_apply: Operation not permitted")).toContain(
    "could not apply its profile",
  )
  expect(SandboxDiagnostics.hint("cat: /external/file: Operation not permitted")).toContain(
    "may be the sandbox or normal account permissions",
  )
  expect(SandboxDiagnostics.hint("syntax error near unexpected token")).toBeUndefined()
  expect(SandboxDiagnostics.hint("build failed: unknown identifier")).toBeUndefined()
})

it.live("startup reports profile and helper failures without attempting an unsandboxed fallback", () =>
  Effect.gen(function* () {
    for (const failAt of [1, 2]) {
      const calls: string[] = []
      const error = yield* Effect.flip(
        SandboxCheck.run({
          directory: "/test/workspace",
          scratch: "/test/scratch",
          fullDiskRead: false,
          readableRoots: [],
          writableRoots: [],
          protectedPaths: [],
          unreadablePaths: [],
        }).pipe(
          Effect.provide(
            Layer.mock(AppProcess.Service, {
              run: (command) => {
                if (command._tag !== "StandardCommand") return Effect.die("Unexpected pipeline")
                calls.push(command.command)
                return calls.length === failAt
                  ? Effect.fail(
                      new AppProcess.AppProcessError({
                        command: command.command,
                        exitCode: 71,
                        stderr:
                          failAt === 1
                            ? "sandbox-exec: sandbox_apply: Operation not permitted"
                            : "dyld[123]: Library not loaded: /missing/library",
                      }),
                    )
                  : Effect.succeed({
                      command: command.command,
                      exitCode: 0,
                      stdout: Buffer.alloc(0),
                      stderr: Buffer.alloc(0),
                      stdoutTruncated: false,
                      stderrTruncated: false,
                    })
              },
            }),
          ),
        ),
      )
      expect(error.message).toContain(
        failAt === 1 ? "Cannot apply sandbox profile" : "Cannot start sandbox file runtime",
      )
      expect(error.message).not.toContain("--eval")
      expect(calls).toEqual(Array(failAt).fill("/usr/bin/sandbox-exec"))
    }
  }),
)
