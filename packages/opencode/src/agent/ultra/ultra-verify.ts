import * as Tool from "@/tool/tool"
import { Shell } from "@opencode-ai/core/shell"
import { Schema } from "effect"
import { UltraState, use as useUltra, maxRetries } from "./ultra-state"

export const Parameters = Schema.Struct({})

export const UltraVerifyTool = Tool.define(
  "ultra_verify",
  Effect.gen(function* () {
    const shell = yield* Shell.Service
    const ultra = yield* useUltra

    return {
      description: [
        "Auto-detect and run the project's test suite.",
        "Detects test command from package.json / Makefile / Cargo.toml / pyproject.toml / go.mod.",
        "Returns structured result with pass/fail status.",
        "Auto-transitions to 'complete' on pass or 'iterating' on fail (up to 10 retries).",
      ].join(" "),
      parameters: Parameters,
      execute: (_args, ctx) =>
        Effect.gen(function* () {
          const state = yield* ultra.get(ctx.sessionID)
          if (!state || state.phase !== "verifying") {
            return {
              title: "Verify",
              metadata: {},
              output: "ERROR: ultra_verify can only be called during the 'verifying' phase.",
            }
          }

          const detectCmd = [
            "if [ -f package.json ]; then echo 'npm test'",
            "elif [ -f Makefile ]; then echo 'make test'",
            "elif [ -f Cargo.toml ]; then echo 'cargo test'",
            "elif [ -f pyproject.toml ] || [ -f setup.py ]; then echo 'pytest'",
            "elif [ -f go.mod ]; then echo 'go test ./...'",
            "else echo '__none__'",
            "fi",
          ].join("; ")

          const detectResult = yield* shell.run({
            command: detectCmd,
            cwd: process.cwd(),
          })

          const testCmd = detectResult.trim()
          if (testCmd === "__none__") {
            yield* ultra.transition(ctx.sessionID, "complete")
            return {
              title: "Verify",
              metadata: { phase: "complete" },
              output: "No test framework detected. Marking as complete.",
            }
          }

          let exitCode = 0
          let stdout = ""
          let stderr = ""
          try {
            const result = yield* shell.run({ command: testCmd, cwd: process.cwd() })
            stdout = result
          } catch (error: any) {
            exitCode = 1
            stderr = String(error)
          }

          const passed = exitCode === 0
          const retryCount = yield* ultra.incrementRetry(ctx.sessionID)

          if (passed) {
            yield* ultra.transition(ctx.sessionID, "complete")
            return {
              title: "Verify",
              metadata: { phase: "complete", passed: true },
              output: [
                "TESTS PASSED ✓",
                "",
                `Command: ${testCmd}`,
                stdout ? `Output:\n${stdout.slice(-2000)}` : "",
              ]
                .filter(Boolean)
                .join("\n"),
            }
          }

          if (retryCount >= maxRetries) {
            yield* ultra.transition(ctx.sessionID, "complete")
            return {
              title: "Verify",
              metadata: { phase: "complete", passed: false, retriesExhausted: true },
              output: [
                `TESTS FAILED after ${maxRetries} retries. Stopping.`,
                "",
                `Command: ${testCmd}`,
                stderr ? `Error:\n${stderr.slice(-2000)}` : "",
              ]
                .filter(Boolean)
                .join("\n"),
            }
          }

          yield* ultra.transition(ctx.sessionID, "iterating")
          return {
            title: "Verify",
            metadata: { phase: "iterating", passed: false, retry: retryCount },
            output: [
              `TESTS FAILED (attempt ${retryCount}/${maxRetries})`,
              "",
              `Command: ${testCmd}`,
              stderr ? `Error:\n${stderr.slice(-2000)}` : "",
              "",
              "Transitioning to 'iterating' phase. Fix the failures and verify again.",
            ]
              .filter(Boolean)
              .join("\n"),
          }
        }),
    }
  }),
)
