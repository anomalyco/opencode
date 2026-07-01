// Subprocess integration tests for `opencode run` (non-interactive mode).
// These exercise the real CLI binary against a TestLLMServer running in the
// same process. See `test/lib/cli-process.ts` for the harness — each test uses
// `opencode.run(message, opts?)` to spawn `bun src/index.ts run ...` with
// an isolated test provider config under the fixture's temp home.
import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { reply } from "../../lib/llm-server"
import { cliIt } from "../../lib/cli-process"
import { testProviderConfig } from "../../lib/test-provider"

describe("opencode run (non-interactive subprocess)", () => {
  // Happy path: prompt completes, output reaches stdout, process exits 0.
  // If this fails, all the others likely will too — debug here first.
  cliIt.concurrent(
    "exits 0 and writes the response to stdout on a successful prompt",
    ({ llm, opencode }) =>
      Effect.gen(function* () {
        yield* llm.text("hello from the test llm")
        const result = yield* opencode.run("say hi")
        opencode.expectExit(result, 0)
        expect(result.stdout).toBe("hello from the test llm\n")
      }),
    60_000,
  )

  cliIt.concurrent(
    "prints each completed text part in order around a tool continuation",
    ({ llm, opencode }) =>
      Effect.gen(function* () {
        yield* llm.push(
          reply().text("  before tool  ").tool("shell", {
            command: "printf tool-output",
            description: "Print deterministic output",
          }),
        )
        yield* llm.text("  after tool  ")

        const result = yield* opencode.run("use a tool", {
          extraArgs: ["--dangerously-skip-permissions"],
        })

        opencode.expectExit(result, 0)
        expect(result.stdout).toBe("before tool\nafter tool\n")
      }),
    60_000,
  )

  cliIt.concurrent(
    "prints reasoning before text only with --thinking",
    ({ llm, opencode }) =>
      Effect.gen(function* () {
        yield* llm.reason("  considering  ", { text: "  answer  " })
        const thinking = yield* opencode.run("think", { extraArgs: ["--thinking"] })
        opencode.expectExit(thinking, 0)
        expect(thinking.stdout).toBe("Thinking: considering\nanswer\n")

        yield* llm.reason("hidden", { text: "visible" })
        const plain = yield* opencode.run("think again")
        opencode.expectExit(plain, 0)
        expect(plain.stdout).toBe("visible\n")
      }),
    60_000,
  )

  // Regression for #27371: an unknown model used to hang the process forever
  // waiting on a session.status === idle event that never arrived. The fix
  // makes the SDK call surface an error promptly so the process exits nonzero.
  // We assert nonzero exit AND wall-clock under the harness timeout — a hang
  // would expire the timeout and produce a different (signal-killed) failure.
  cliIt.concurrent(
    "exits nonzero promptly when the model is unknown (regression for #27371)",
    ({ opencode }) =>
      Effect.gen(function* () {
        const result = yield* opencode.run("say hi", {
          model: "test/nonexistent-model",
          timeoutMs: 15_000,
        })
        expect(result.exitCode).not.toBe(0)
        expect(result.durationMs).toBeLessThan(15_000)
      }),
    30_000,
  )

  // The test provider's SSE error item is interpreted by the SDK as an unknown
  // finish, not a fatal provider/session error. Lock that distinction in so it
  // is not accidentally used as the failure compatibility oracle.
  cliIt.concurrent(
    "unknown stream finish preserves partial output and exits 0",
    ({ llm, opencode }) =>
      Effect.gen(function* () {
        yield* llm.push(
          reply().text("partial response").tool("shell", {
            command: "printf tool",
            description: "Print deterministic output",
          }),
        )
        yield* llm.fail("upstream provider exploded mid-stream")
        const result = yield* opencode.run("trigger midstream error", { timeoutMs: 30_000 })
        expect(result.exitCode).toBe(0)
        expect(result.stdout).toBe("partial response\n")
        expect(result.stderr).not.toContain("upstream provider exploded mid-stream")
      }),
    60_000,
  )

  // --format json puts one JSON object per line on stdout for each emitted
  // event. Consumers (CI scripts, tooling) parse this stream. Asserts the
  // shape so a future event-emit change has to update this expectation.
  cliIt.concurrent(
    "--format json emits parseable line-delimited JSON to stdout",
    ({ llm, opencode }) =>
      Effect.gen(function* () {
        yield* llm.text("structured output")
        const result = yield* opencode.run("say hi", { format: "json" })
        opencode.expectExit(result, 0)

        const events = opencode.parseJsonEvents(result.stdout)
        expect(events.length).toBeGreaterThan(0)
        for (const evt of events) {
          expect(typeof evt.type).toBe("string")
          expect(typeof evt.sessionID).toBe("string")
        }
        expect(events.map((event) => event.type)).toEqual(["step_start", "text", "step_finish"])
        expect(events.map(({ timestamp: _, sessionID: __, ...event }) => event)).toEqual([
          { type: "step_start", part: expect.objectContaining({ type: "step-start" }) },
          {
            type: "text",
            part: expect.objectContaining({ type: "text", text: "structured output" }),
          },
          { type: "step_finish", part: expect.objectContaining({ type: "step-finish" }) },
        ])
        expect(result.stdout.endsWith("\n")).toBe(true)
        expect(
          result.stdout
            .split("\n")
            .slice(0, -1)
            .every((line) => line.length > 0),
        ).toBe(true)
      }),
    60_000,
  )

  cliIt.concurrent(
    "--format json emits a pure error record for a rejected prompt request",
    ({ opencode }) =>
      Effect.gen(function* () {
        const result = yield* opencode.run("use an unknown model", {
          model: "test/nonexistent-model",
          format: "json",
        })

        expect(result.exitCode).not.toBe(0)
        const events = opencode.parseJsonEvents(result.stdout)
        expect(events.map((event) => event.type)).toEqual(["error"])
        expect(events[0]).toEqual({
          type: "error",
          timestamp: expect.any(Number),
          sessionID: expect.any(String),
          error: expect.any(Object),
        })
        expect(result.stdout.split("\n").filter(Boolean)).toHaveLength(1)
      }),
    30_000,
  )

  cliIt.concurrent(
    "--format json preserves reasoning, tool, and continuation ordering",
    ({ llm, opencode }) =>
      Effect.gen(function* () {
        yield* llm.push(
          reply().reason("reasoning").text("before").tool("shell", {
            command: "printf tool",
            description: "Print deterministic output",
          }),
        )
        yield* llm.text("after")

        const result = yield* opencode.run("exercise json records", {
          format: "json",
          extraArgs: ["--thinking", "--dangerously-skip-permissions"],
        })

        expect(result.exitCode).toBe(0)
        const events = opencode.parseJsonEvents(result.stdout)
        expect(events.map((event) => event.type)).toEqual([
          "step_start",
          "reasoning",
          "text",
          "tool_use",
          "step_finish",
          "step_start",
          "text",
          "step_finish",
        ])
        expect(events.find((event) => event.type === "reasoning")?.part).toEqual(
          expect.objectContaining({ type: "reasoning", text: "reasoning" }),
        )
        expect(events.find((event) => event.type === "tool_use")?.part).toEqual(
          expect.objectContaining({
            type: "tool",
            tool: "shell",
            state: expect.objectContaining({ status: "completed" }),
          }),
        )
        expect(
          result.stdout
            .split("\n")
            .slice(0, -1)
            .every((line) => line.startsWith("{")),
        ).toBe(true)
      }),
    60_000,
  )

  cliIt.concurrent(
    "--format json records partial output for an unknown stream finish",
    ({ llm, opencode }) =>
      Effect.gen(function* () {
        yield* llm.push(
          reply().text("partial json").tool("shell", {
            command: "printf tool",
            description: "Print deterministic output",
          }),
        )
        yield* llm.fail("provider failed")
        const result = yield* opencode.run("fail after output", { format: "json" })

        const events = opencode.parseJsonEvents(result.stdout)
        expect(result.exitCode).toBe(0)
        expect(events.map((event) => event.type)).toEqual(["step_start", "text", "tool_use", "step_finish"])
        expect(events[1]?.part).toEqual(expect.objectContaining({ type: "text", text: "partial json" }))
        expect(events.at(-1)?.part).toEqual(expect.objectContaining({ type: "step-finish" }))
      }),
    60_000,
  )

  cliIt.concurrent(
    "rejects requested permissions by default and allows them with the dangerous flag",
    ({ home, llm, opencode }) =>
      Effect.gen(function* () {
        yield* llm.tool("shell", { command: "rm -f denied-file", description: "Remove a test file" })
        yield* llm.text("continued after rejection")
        const denied = yield* opencode.run("request permission", { permission: { shell: "ask" } })
        opencode.expectExit(denied, 0)
        expect(denied.stderr).toContain("permission requested: shell")
        expect(denied.stdout).toBe("")

        yield* llm.reset
        yield* llm.tool("shell", { command: "rm -f allowed-file", description: "Remove a test file" })
        yield* llm.text("continued after approval")
        const allowed = yield* opencode.run("request permission", {
          permission: { shell: "ask" },
          extraArgs: ["--dangerously-skip-permissions"],
        })
        opencode.expectExit(allowed, 0)
        expect(allowed.stderr).not.toContain("permission requested: shell")
        expect(allowed.stdout).toContain("continued after approval")

        yield* llm.reset
        yield* llm.tool("shell", { command: "touch explicitly-denied", description: "Create a denied marker" })
        yield* llm.text("continued after explicit denial")
        const explicitlyDenied = yield* opencode.run("request denied permission", {
          permission: { shell: "deny" },
          extraArgs: ["--dangerously-skip-permissions"],
        })
        opencode.expectExit(explicitlyDenied, 0)
        expect(explicitlyDenied.stdout).toContain("continued after explicit denial")
        expect(yield* Effect.promise(() => Bun.file(`${home}/explicitly-denied`).exists())).toBe(false)
      }),
    60_000,
  )

  cliIt.concurrent(
    "rejects unattended questions without hanging",
    ({ llm, opencode }) =>
      Effect.gen(function* () {
        yield* llm.tool("question", {
          questions: [
            {
              question: "Continue?",
              header: "Continue",
              options: [{ label: "Yes", description: "Continue execution" }],
            },
          ],
        })
        const result = yield* opencode.run("ask a question")

        opencode.expectExit(result, 0)
        expect(result.stdout).toBe("")
      }),
    60_000,
  )

  cliIt.concurrent(
    "continues a current session with projected history",
    ({ home, llm, opencode }) =>
      Effect.gen(function* () {
        const env = { OPENCODE_DB: `${home}/run-continue.sqlite` }
        yield* llm.text("first response")
        const first = yield* opencode.run("first prompt", { env })
        opencode.expectExit(first, 0)

        yield* llm.text("second response")
        const second = yield* opencode.run("second prompt", { env, extraArgs: ["--continue"] })
        opencode.expectExit(second, 0)
        expect(second.stdout).toBe("second response\n")
        expect(JSON.stringify((yield* llm.inputs).at(-1))).toContain("first prompt")
      }),
    60_000,
  )

  cliIt.concurrent(
    "forks the latest current session for --continue",
    ({ home, llm, opencode }) =>
      Effect.gen(function* () {
        const env = { OPENCODE_DB: `${home}/run-fork-continue.sqlite` }
        yield* llm.text("first response")
        const first = yield* opencode.run("first prompt", { env, format: "json" })
        opencode.expectExit(first, 0)
        const firstSessionID = opencode.parseJsonEvents(first.stdout)[0]?.sessionID
        expect(typeof firstSessionID).toBe("string")

        yield* llm.text("forked response")
        const second = yield* opencode.run("second prompt", {
          env,
          format: "json",
          extraArgs: ["--continue", "--fork"],
        })

        opencode.expectExit(second, 0)
        const secondSessionID = String(opencode.parseJsonEvents(second.stdout)[0]?.sessionID)
        expect(secondSessionID).not.toBe(String(firstSessionID))
        expect(JSON.stringify((yield* llm.inputs).at(-1))).toContain("first prompt")
      }),
    60_000,
  )

  cliIt.concurrent(
    "forks a current session selected by --session",
    ({ home, llm, opencode }) =>
      Effect.gen(function* () {
        const env = { OPENCODE_DB: `${home}/run-fork-session.sqlite` }
        yield* llm.text("first response")
        const first = yield* opencode.run("first prompt", { env, format: "json" })
        opencode.expectExit(first, 0)
        const firstSessionID = opencode.parseJsonEvents(first.stdout)[0]?.sessionID
        expect(typeof firstSessionID).toBe("string")

        yield* llm.text("forked response")
        const second = yield* opencode.run("second prompt", {
          env,
          format: "json",
          extraArgs: ["--session", String(firstSessionID), "--fork"],
        })

        opencode.expectExit(second, 0)
        const secondSessionID = String(opencode.parseJsonEvents(second.stdout)[0]?.sessionID)
        expect(secondSessionID).not.toBe(String(firstSessionID))
        expect(JSON.stringify((yield* llm.inputs).at(-1))).toContain("first prompt")
      }),
    60_000,
  )

  cliIt.concurrent(
    "applies a variant to the configured default model",
    ({ llm, opencode }) =>
      Effect.gen(function* () {
        yield* llm.text("variant response")
        const result = yield* opencode.spawn(["run", "--variant", "default", "use the default model"], {
          config: { ...testProviderConfig(llm.url), model: "test/test-model" },
        })

        opencode.expectExit(result, 0)
        expect(result.stdout).toBe("variant response\n")
      }),
    60_000,
  )

  cliIt.live(
    "preserves local image files as media attachments",
    ({ home, llm, opencode }) =>
      Effect.gen(function* () {
        const source = `${home}/image.png`
        yield* Effect.promise(() => Bun.write(source, Buffer.from("iVBORw0KGgo=", "base64")))
        yield* llm.text("attachment received")
        const config = testProviderConfig(llm.url)
        config.provider.test.models["test-model"].attachment = true

        const result = yield* opencode.run("read the attachment", {
          extraArgs: [`--file=${source}`, "--"],
          config,
        })

        opencode.expectExit(result, 0)
        const input = JSON.stringify(yield* llm.inputs)
        expect(input).toContain("image/png")
        expect(input).not.toContain("<file name=\\\"image.png\\\">")
      }),
    60_000,
  )

  cliIt.live(
    "attach mode sends client-local file contents without a shared path",
    ({ home, llm, opencode }) =>
      Effect.gen(function* () {
        const source = `${home}/client-only.txt`
        const sentinel = "client-only attachment sentinel"
        yield* Effect.promise(() => Bun.write(source, sentinel))
        yield* llm.text("attachment received")
        const server = yield* opencode.serve()

        const result = yield* opencode.run("read the attachment", {
          extraArgs: ["--attach", server.url, `--file=${source}`, "--"],
        })

        opencode.expectExit(result, 0)
        const input = JSON.stringify(yield* llm.inputs)
        expect(input).toContain(sentinel)
        expect(input).not.toContain(`file://${source}`)
      }),
    60_000,
  )

  cliIt.concurrent(
    "attach mode rejects local directories before prompt admission",
    ({ home, opencode }) =>
      Effect.gen(function* () {
        const result = yield* opencode.run("read the directory", {
          extraArgs: ["--attach", "http://127.0.0.1:1", `--file=${home}`, "--"],
        })

        expect(result.exitCode).not.toBe(0)
        expect(result.stderr).toContain("Cannot attach local directory without a shared filesystem")
      }),
    30_000,
  )

  cliIt.live(
    "SIGINT interrupts an active non-interactive run without leaking the process",
    ({ llm, opencode }) =>
      Effect.gen(function* () {
        yield* llm.hang
        const run = yield* opencode.startRun("wait forever")
        yield* llm.wait(1)
        run.interrupt()
        const result = yield* run.result

        expect(result.exitCode).not.toBe(0)
        expect(result.durationMs).toBeLessThan(30_000)
      }),
    30_000,
  )

  cliIt.live(
    "SIGINT before admission prevents provider execution",
    ({ llm, opencode }) =>
      Effect.gen(function* () {
        yield* llm.hang
        const run = yield* opencode.startRun("do not start")
        run.interrupt()
        const result = yield* run.result

        expect(result.exitCode).not.toBe(0)
        expect(yield* llm.inputs).toHaveLength(0)
      }),
    30_000,
  )
})
