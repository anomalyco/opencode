// Subprocess integration tests for `opencode run` (non-interactive mode).
// These exercise the real CLI binary against a TestLLMServer running in the
// same process. See `test/lib/cli-process.ts` for the harness — each test uses
// `opencode.run(message, opts?)` to spawn `bun src/index.ts run ...` with
// `OPENCODE_CONFIG_CONTENT` providing the test provider config inline.
import { describe, expect, test } from "bun:test"
import { Database } from "bun:sqlite"
import path from "node:path"
import { Effect } from "effect"
import { reply } from "../../lib/llm-server"
import { cliIt } from "../../lib/cli-process"
import { createRunErrorDeduper } from "../../../src/cli/cmd/run-error"

test("JSON error deduplication preserves distinct session errors and drops the request duplicate", () => {
  const duplicate = createRunErrorDeduper()
  expect(duplicate({ name: "ModelError", data: { message: "missing model" } }, "session")).toBe(false)
  expect(duplicate({ name: "ToolError", data: { message: "tool failed" } }, "session")).toBe(false)
  expect(duplicate({ name: "UnknownError", data: { message: "Unexpected server error." } }, "request")).toBe(true)

  const reversed = createRunErrorDeduper()
  const error = { name: "ModelError", data: { message: "missing model" } }
  expect(reversed(error, "request")).toBe(false)
  expect(reversed(error, "session")).toBe(true)
})

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

  cliIt.live(
    "prints a reply from another process that continued the session",
    ({ home, llm, opencode }) =>
      Effect.gen(function* () {
        const phase = <A>(name: string, effect: Effect.Effect<A>) =>
          effect.pipe(
            Effect.timeoutOrElse({
              duration: "20 seconds",
              orElse: () => Effect.fail(new Error(`timed out waiting for ${name}`)),
            }),
          )
        const databasePath = path.join(home, "shared.db")
        const env = { OPENCODE_DB: databasePath }
        yield* llm.text("seed reply")
        const seed = yield* opencode.run("seed", { format: "json", env })
        const sessionID = opencode.parseJsonEvents(seed.stdout).at(-1)?.sessionID
        if (typeof sessionID !== "string") throw new Error("seed run did not emit a session ID")

        const db = new Database(databasePath, { readonly: true })
        const count = (role: string) =>
          Number(
            (
              db
                .query(
                  "SELECT COUNT(*) AS count FROM message WHERE session_id = ? AND json_extract(data, '$.role') = ?",
                )
                .get(sessionID, role) as { count: number } | undefined
            )?.count,
          )
        expect(count("user")).toBe(1)
        expect(count("assistant")).toBe(1)

        yield* llm.reset
        let release: () => void = () => {}
        const gate = new Promise<void>((resolve) => {
          release = resolve
        })
        yield* Effect.addFinalizer(() => Effect.sync(release))
        yield* llm.hold("first reply", gate)
        const first = yield* opencode.startRun("first prompt", {
          format: "json",
          extraArgs: ["--session", String(sessionID)],
          env,
        })
        const firstRequestDeadline = Date.now() + 20_000
        while (Date.now() < firstRequestDeadline && !JSON.stringify(yield* llm.inputs).includes("first prompt")) {
          yield* Effect.sleep("25 millis")
        }
        if (!JSON.stringify(yield* llm.inputs).includes("first prompt")) {
          throw new Error("timed out waiting for A's first provider request")
        }

        const second = yield* opencode.startRun("reply two", {
          format: "json",
          extraArgs: ["--session", String(sessionID)],
          env,
        })
        const deadline = Date.now() + 10_000
        while (Date.now() < deadline && count("user") < 3) {
          yield* Effect.sleep("25 millis")
        }
        const userCount = count("user")
        db.close()
        if (userCount !== 3) throw new Error(`timed out waiting for B's admitted user row; found ${userCount}`)
        expect(userCount).toBe(3)

        yield* llm.text("two")
        release()
        const secondRequestDeadline = Date.now() + 20_000
        const isTitle = (input: Record<string, unknown>) =>
          JSON.stringify(input).includes("Generate a title for this conversation")
        let inputs = yield* llm.inputs
        while (Date.now() < secondRequestDeadline && inputs.filter((input) => !isTitle(input)).length < 2) {
          yield* Effect.sleep("25 millis")
          inputs = yield* llm.inputs
        }
        const modelRequests = inputs.filter((input) => !isTitle(input))
        if (modelRequests.length !== 2) {
          throw new Error(
            `timed out waiting for A's continuation request; found ${modelRequests.length} provider requests`,
          )
        }
        expect(modelRequests).toHaveLength(2)
        const firstResult = yield* phase("A exit", first.result)
        const firstText = opencode
          .parseJsonEvents(firstResult.stdout)
          .filter((event) => event.type === "text")
          .map((event) => (event.part as { text: string }).text)
        expect(firstText).toContain("two")
        const modelRequestsAfterRun = (yield* llm.inputs).filter((input) => !isTitle(input))
        expect(modelRequestsAfterRun).toHaveLength(2)
        const secondResult = yield* phase("B exit", second.result)
        const secondEvents = opencode.parseJsonEvents(secondResult.stdout)
        expect(firstResult.exitCode).toBe(0)
        expect(secondResult.exitCode).toBe(0)
        expect(secondEvents.map((event) => event.type)).toEqual(["step_start", "text", "step_finish"])
        expect(
          secondEvents.filter((event) => event.type === "text").map((event) => (event.part as { text: string }).text),
        ).toEqual(["two"])
      }),
    60_000,
  )

  cliIt.live(
    "prints every turn from another process that continued the session",
    ({ home, llm, opencode }) =>
      Effect.gen(function* () {
        const phase = <A>(name: string, effect: Effect.Effect<A>) =>
          effect.pipe(
            Effect.timeoutOrElse({
              duration: "20 seconds",
              orElse: () => Effect.fail(new Error(`timed out waiting for ${name}`)),
            }),
          )
        const databasePath = path.join(home, "shared.db")
        const env = { OPENCODE_DB: databasePath }
        yield* llm.text("seed reply")
        const seed = yield* opencode.run("seed", { format: "json", env })
        const sessionID = opencode.parseJsonEvents(seed.stdout).at(-1)?.sessionID
        if (typeof sessionID !== "string") throw new Error("seed run did not emit a session ID")

        const db = new Database(databasePath, { readonly: true })
        const userCount = () =>
          Number(
            (
              db
                .query(
                  "SELECT COUNT(*) AS count FROM message WHERE session_id = ? AND json_extract(data, '$.role') = 'user'",
                )
                .get(sessionID) as { count: number } | undefined
            )?.count,
          )
        expect(userCount()).toBe(1)

        yield* llm.reset
        let release: () => void = () => {}
        const gate = new Promise<void>((resolve) => {
          release = resolve
        })
        yield* Effect.addFinalizer(() => Effect.sync(release))
        yield* llm.hold("first reply", gate)
        const first = yield* opencode.startRun("first prompt", {
          format: "json",
          extraArgs: ["--session", sessionID, "--dangerously-skip-permissions"],
          env,
        })
        const firstRequestDeadline = Date.now() + 20_000
        while (Date.now() < firstRequestDeadline && !JSON.stringify(yield* llm.inputs).includes("first prompt")) {
          yield* Effect.sleep("25 millis")
        }
        if (!JSON.stringify(yield* llm.inputs).includes("first prompt")) {
          throw new Error("timed out waiting for A's first provider request")
        }

        const second = yield* opencode.startRun("reply two", {
          format: "json",
          extraArgs: ["--session", sessionID],
          env,
        })
        const admissionDeadline = Date.now() + 10_000
        while (Date.now() < admissionDeadline && userCount() < 3) yield* Effect.sleep("25 millis")
        const admittedUsers = userCount()
        db.close()
        if (admittedUsers !== 3) throw new Error(`timed out waiting for B's admitted user row; found ${admittedUsers}`)

        yield* llm.push(
          reply().text("before tool").tool("bash", {
            command: "printf tool-output",
            description: "Print deterministic output",
          }),
        )
        yield* llm.text("final text")
        release()
        const requestDeadline = Date.now() + 20_000
        const isTitle = (input: Record<string, unknown>) =>
          JSON.stringify(input).includes("Generate a title for this conversation")
        let inputs = yield* llm.inputs
        while (Date.now() < requestDeadline && inputs.filter((input) => !isTitle(input)).length < 3) {
          yield* Effect.sleep("25 millis")
          inputs = yield* llm.inputs
        }
        const modelRequests = inputs.filter((input) => !isTitle(input))
        if (modelRequests.length !== 3) {
          throw new Error(
            `timed out waiting for A's two continuation requests; found ${modelRequests.length} provider requests`,
          )
        }
        const firstResult = yield* phase("A exit", first.result)
        const firstText = opencode
          .parseJsonEvents(firstResult.stdout)
          .filter((event) => event.type === "text")
          .map((event) => (event.part as { text: string }).text)
        expect(firstResult.exitCode).toBe(0)
        expect(firstText).toContain("before tool")
        expect(firstText).toContain("final text")
        const secondResult = yield* phase("B exit", second.result)
        const secondText = opencode
          .parseJsonEvents(secondResult.stdout)
          .filter((event) => event.type === "text")
          .map((event) => (event.part as { text: string }).text)
        expect(secondResult.exitCode).toBe(0)
        expect(secondText).toEqual(["before tool", "final text"])
      }),
    60_000,
  )

  cliIt.concurrent(
    "prints each completed text part in order around a tool continuation",
    ({ llm, opencode }) =>
      Effect.gen(function* () {
        yield* llm.push(
          reply().text("  before tool  ").tool("bash", {
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
  // finish, not a fatal provider/session error. Unknown finishes should continue
  // the prompt loop so a subsequent response can complete the run.
  cliIt.concurrent(
    "unknown stream finish preserves partial output and continues",
    ({ llm, opencode }) =>
      Effect.gen(function* () {
        yield* llm.push(
          reply().text("partial response").tool("bash", {
            command: "printf tool",
            description: "Print deterministic output",
          }),
        )
        yield* llm.fail("upstream provider exploded mid-stream")
        yield* llm.text("recovered")
        const result = yield* opencode.run("trigger midstream error", { timeoutMs: 30_000 })
        expect(result.exitCode).toBe(0)
        expect(result.stdout).toBe("partial response\nrecovered\n")
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
        const textPartIDs = events
          .filter((event) => event.type === "text")
          .map((event) => (event.part as { id: string }).id)
        expect(new Set(textPartIDs).size).toBe(textPartIDs.length)
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
          reply().reason("reasoning").text("before").tool("bash", {
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
            tool: "bash",
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
    "--format json records an unknown stream finish and continuation",
    ({ llm, opencode }) =>
      Effect.gen(function* () {
        yield* llm.push(
          reply().text("partial json").tool("bash", {
            command: "printf tool",
            description: "Print deterministic output",
          }),
        )
        yield* llm.fail("provider failed")
        yield* llm.text("recovered")
        const result = yield* opencode.run("fail after output", { format: "json" })

        const events = opencode.parseJsonEvents(result.stdout)
        expect(result.exitCode).toBe(0)
        expect(events.map((event) => event.type)).toEqual([
          "step_start",
          "text",
          "tool_use",
          "step_finish",
          "step_start",
          "step_finish",
          "step_start",
          "text",
          "step_finish",
        ])
        expect(events[1]?.part).toEqual(expect.objectContaining({ type: "text", text: "partial json" }))
        expect(events[5]?.part).toEqual(expect.objectContaining({ type: "step-finish", reason: "unknown" }))
        expect(events[7]?.part).toEqual(expect.objectContaining({ type: "text", text: "recovered" }))
        expect(events.at(-1)?.part).toEqual(expect.objectContaining({ type: "step-finish", reason: "stop" }))
      }),
    60_000,
  )

  cliIt.concurrent(
    "rejects requested permissions by default and allows them with the dangerous flag",
    ({ home, llm, opencode }) =>
      Effect.gen(function* () {
        yield* llm.tool("bash", { command: "rm -f denied-file", description: "Remove a test file" })
        yield* llm.text("continued after rejection")
        const denied = yield* opencode.run("request permission", { permission: { bash: "ask" } })
        opencode.expectExit(denied, 0)
        expect(denied.stderr).toContain("permission requested: bash")
        expect(denied.stdout).toBe("")

        yield* llm.reset
        yield* llm.tool("bash", { command: "rm -f allowed-file", description: "Remove a test file" })
        yield* llm.text("continued after approval")
        const allowed = yield* opencode.run("request permission", {
          permission: { bash: "ask" },
          extraArgs: ["--dangerously-skip-permissions"],
        })
        opencode.expectExit(allowed, 0)
        expect(allowed.stderr).not.toContain("permission requested: bash")
        expect(allowed.stdout).toContain("continued after approval")

        yield* llm.reset
        yield* llm.tool("bash", { command: "touch explicitly-denied", description: "Create a denied marker" })
        yield* llm.text("continued after explicit denial")
        const explicitlyDenied = yield* opencode.run("request denied permission", {
          permission: { bash: "deny" },
          extraArgs: ["--dangerously-skip-permissions"],
        })
        opencode.expectExit(explicitlyDenied, 0)
        expect(explicitlyDenied.stdout).toContain("continued after explicit denial")
        expect(yield* Effect.promise(() => Bun.file(`${home}/explicitly-denied`).exists())).toBe(false)
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
})
