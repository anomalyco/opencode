import { readFile, readdir, rm, stat } from "node:fs/promises"
import { resolve } from "node:path"
import { expect, it } from "@effect/vitest"
import { Cause, Effect, Exit } from "effect"
import { Llm, OpenCodeDriver } from "../../src/index.js"

const fakeOpenCode = [
  process.execPath,
  resolve("test", "fixtures", "fake-opencode.ts"),
]

it.live("runs and settles a complete scoped driver", () =>
  Effect.gen(function* () {
    const result = yield* OpenCodeDriver.use(
      {
        keepArtifacts: true,
        project: {
          git: true,
          files: {
            "src/seeded.ts": "export const seeded = true\n",
          },
        },
        config: {
          autoupdate: false,
          nested: { declared: true, winner: "declared" },
          items: ["declared"],
        },
        tuiConfig: { theme: { declared: true } },
        setup: ({ config, tuiConfig }) =>
          Effect.sync(() => {
            config.nested = {
              ...config.nested as Record<string, boolean | string>,
              winner: "setup",
            }
            tuiConfig.theme = {
              ...tuiConfig.theme as Record<string, boolean>,
              setup: true,
            }
          }),
        tui: {
          recording: true,
          viewport: { cols: 96, rows: 32 },
        },
        opencode: { command: fakeOpenCode },
      },
      (driver) =>
        Effect.gen(function* () {
          expect(yield* driver.opencode.health.get()).toMatchObject({
            healthy: true,
            version: "test",
          })
          expect(yield* driver.opencode.server.get()).toEqual({ urls: [] })
          yield* driver.llm.queue(
            Llm.text("library response", { delay: 0, chunkSize: 100 }),
          )
          yield* driver.ui.submit("hello from library")
          yield* driver.ui.waitFor("hello from library")
          const secondary = yield* driver.tuis.launch({
            viewport: { cols: 120, rows: 40 },
          })
          yield* secondary.ui.submit("hello from secondary")
          yield* secondary.ui.waitFor("hello from secondary")
          return {
            artifacts: driver.artifacts,
            recording: driver.tui.recording?.path,
          }
        }),
    )

    yield* Effect.addFinalizer(() =>
      Effect.tryPromise({
        try: async () => {
          await rm(result.artifacts, { recursive: true, force: true })
          if (result.recording !== undefined)
            await rm(result.recording, { force: true })
        },
        catch: () => undefined,
      }).pipe(Effect.ignore),
    )

    expect(result.recording).toBeDefined()
    expect(
      yield* Effect.promise(() =>
        readFile(`${result.artifacts}/seeded-at-launch.txt`, "utf8"),
      ),
    ).toBe("export const seeded = true\n")
    expect(
      yield* Effect.promise(() =>
        readFile(
          `${result.artifacts}/files/.opencode/opencode.jsonc`,
          "utf8",
        ).then(JSON.parse),
      ),
    ).toMatchObject({
      autoupdate: false,
      nested: { declared: true, winner: "setup" },
      items: ["declared"],
    })
    expect(
      yield* Effect.promise(() =>
        readFile(
          `${result.artifacts}/files/.opencode/tui.jsonc`,
          "utf8",
        ).then(JSON.parse),
      ),
    ).toEqual({ theme: { declared: true, setup: true } })
    expect(
      yield* Effect.promise(() =>
        readFile(`${result.artifacts}/backend-events.jsonl`, "utf8"),
      ),
    ).toContain("library response")
    expect(
      result.recording === undefined
        ? false
        : yield* Effect.promise(() =>
            stat(result.recording).then(() => true, () => false),
          ),
    ).toBe(true)

    for (const file of ["service.pid", "child.pid"]) {
      const pid = Number(
        yield* Effect.promise(() =>
          readFile(`${result.artifacts}/${file}`, "utf8"),
        ),
      )
      expect(isRunning(pid)).toBe(false)
    }
  }),
)

it.live("rejects a setup callback that does not return an Effect", () =>
  Effect.gen(function* () {
    const failure = yield* OpenCodeDriver.use(
      {
        setup() {},
        opencode: { command: fakeOpenCode },
      },
      () => Effect.void,
    ).pipe(Effect.flip)

    expect(failure).toMatchObject({
      _tag: "OpenCodeDriverError",
      operation: "project.prepare",
      message: "setup must return an Effect",
    })
  }),
)

it.live("rejects recording for a visible TUI", () =>
  Effect.gen(function* () {
    const failure = yield* OpenCodeDriver.make({
      tui: { recording: true },
      opencode: { command: fakeOpenCode, visible: true },
    }).pipe(Effect.scoped, Effect.flip)

    expect(failure).toMatchObject({
      _tag: "OpenCodeDriverError",
      operation: "tui.launch",
      message: "recording requires a headless OpenCode TUI",
    })
  }),
)

it.live("supports explicit terminal settlement with make", () =>
  Effect.gen(function* () {
    let artifacts = ""
    yield* Effect.scoped(
      Effect.gen(function* () {
        const driver = yield* OpenCodeDriver.make({
          opencode: { command: fakeOpenCode },
        })
        artifacts = driver.artifacts
        yield* driver.llm.queue(
          Llm.text("explicit settlement", { delay: 0, chunkSize: 100 }),
        )
        const settlement = yield* driver.settle()
        expect(settlement).toMatchObject({
          artifacts: driver.artifacts,
          retained: false,
          compatibility: [
            { _tag: "Negotiated", role: "backend", protocolVersion: 1 },
            { _tag: "Negotiated", role: "ui", protocolVersion: 1 },
          ],
          recordings: [],
        })
        const error = yield* driver.tuis.launch().pipe(Effect.flip)
        expect(error).toMatchObject({
          _tag: "OpenCodeDriverError",
          operation: "tui.launch",
        })
      }),
    )
    expect(
      yield* Effect.promise(() => stat(artifacts).then(() => true, () => false)),
    ).toBe(false)
  }),
)

it.live("rolls back a failed initial tool connection", () =>
  Effect.gen(function* () {
    const failure = yield* OpenCodeDriver.make({
      opencode: { command: [...fakeOpenCode, "reject-tool-handshake"] },
    }).pipe(
      Effect.scoped,
      Effect.timeoutOrElse({
        duration: 10_000,
        orElse: () => Effect.dieMessage("failed tool connection did not roll back"),
      }),
      Effect.flip,
    )
    expect(failure).toMatchObject({
      _tag: "OpenCodeDriverError",
      operation: "tools.connect",
    })
  }),
)

it.live("injects declared tool handlers for library drivers", () =>
  Effect.gen(function* () {
    const artifacts = yield* OpenCodeDriver.use(
      {
        keepArtifacts: true,
        opencode: { command: fakeOpenCode },
        tools(tools) {
          tools.handle("shell", () => Effect.succeed({ output: "controlled\n" }))
        },
      },
      (driver) => Effect.succeed(driver.artifacts),
    )
    yield* Effect.addFinalizer(() =>
      Effect.promise(() => rm(artifacts, { recursive: true, force: true })),
    )
    const config = yield* Effect.promise(() =>
      readFile(`${artifacts}/files/.opencode/opencode.jsonc`, "utf8").then(JSON.parse),
    )
    expect(config.plugins).toEqual([
      expect.objectContaining({
        package: expect.stringMatching(/\/src\/tool\/plugin\.js$/),
        options: expect.objectContaining({ tools: ["shell"] }),
      }),
    ])
  }),
)

it.live("exposes runtime controls for tools declared by name", () =>
  Effect.gen(function* () {
    const artifacts = yield* OpenCodeDriver.use(
      {
        keepArtifacts: true,
        opencode: { command: fakeOpenCode },
        tools: ["shell"],
      },
      (driver) =>
        Effect.gen(function* () {
          yield* driver.tools.control("shell")
          return driver.artifacts
        }),
    )
    yield* Effect.addFinalizer(() =>
      Effect.promise(() => rm(artifacts, { recursive: true, force: true })),
    )
    const config = yield* Effect.promise(() =>
      readFile(`${artifacts}/files/.opencode/opencode.jsonc`, "utf8").then(JSON.parse),
    )
    expect(config.plugins).toEqual([
      expect.objectContaining({
        package: expect.stringMatching(/\/src\/tool\/plugin\.js$/),
        options: expect.objectContaining({ tools: ["shell"] }),
      }),
    ])
  }),
)

it.live("controls arbitrary provider-backed tools through the runtime lifecycle", () =>
  Effect.gen(function* () {
    const artifacts = yield* OpenCodeDriver.use(
      {
        keepArtifacts: true,
        opencode: {
          command: [...fakeOpenCode, "dynamic-tool", "reconnect-tool"],
        },
      },
      (driver) =>
        Effect.gen(function* () {
          yield* driver.tools.attach({
            tools: [
              {
                name: "lookup",
                description: "Look up a value",
                inputSchema: {
                  type: "object",
                  properties: { query: { type: "string" } },
                  required: ["query"],
                },
                outputSchema: {
                  type: "object",
                  properties: { answer: { type: "number" } },
                  required: ["answer"],
                },
                options: { codemode: false },
              },
            ],
          })
          const call = yield* driver.tools.take("call_lookup")
          expect(call).toMatchObject({
            name: "lookup",
            input: { query: "meaning" },
            context: { sessionID: "ses_dynamic", callID: "call_lookup" },
          })
          yield* call.progress({
            structured: { phase: "searching" },
            content: [{ type: "text", text: "Searching" }],
          })
          yield* call.finish({
            structured: { answer: 42 },
            content: [{ type: "text", text: "42" }],
          })
          return driver.artifacts
        }),
    )
    yield* Effect.addFinalizer(() =>
      Effect.promise(() => rm(artifacts, { recursive: true, force: true })),
    )
    const events = (yield* Effect.promise(() =>
      readFile(`${artifacts}/tool-events.jsonl`, "utf8"),
    )).trim().split("\n").map((line) => JSON.parse(line))
    expect(events).toEqual([
      expect.objectContaining({ method: "tool.attach" }),
      expect.objectContaining({ method: "tool.attach" }),
      {
        method: "tool.update",
        params: {
          id: "tool_1",
          sequence: 0,
          update: {
            structured: { phase: "searching" },
            content: [{ type: "text", text: "Searching" }],
          },
        },
      },
      {
        method: "tool.finish",
        params: {
          id: "tool_1",
          output: {
            structured: { answer: 42 },
            content: [{ type: "text", text: "42" }],
          },
        },
      },
      {
        method: "tool.attach",
        params: { tools: [] },
      },
    ])
  }),
)

it.live("surfaces a permanent tool reconnect failure", () =>
  Effect.gen(function* () {
    let artifacts = ""
    const result = yield* Effect.exit(
      OpenCodeDriver.use(
        {
          keepArtifacts: true,
          opencode: {
            command: [
              ...fakeOpenCode,
              "dynamic-tool",
              "reconnect-tool",
              "reject-tool-reconnect",
            ],
          },
        },
        (driver) =>
          Effect.gen(function* () {
            artifacts = driver.artifacts
            yield* driver.tools.attach({
              tools: [
                {
                  name: "lookup",
                  description: "Look up a value",
                  inputSchema: { type: "object" },
                  options: { codemode: false },
                },
              ],
            })
            return yield* Effect.never
          }),
      ).pipe(
        Effect.timeoutOrElse({
          duration: 10_000,
          orElse: () => Effect.dieMessage("permanent tool reconnect failure was not observed"),
        }),
      ),
    )
    yield* Effect.addFinalizer(() =>
      artifacts === ""
        ? Effect.void
        : Effect.promise(() => rm(artifacts, { recursive: true, force: true })),
    )
    if (Exit.isSuccess(result))
      return yield* Effect.dieMessage("driver unexpectedly succeeded")
    expect(
      result.cause.reasons
        .filter(Cause.isFailReason)
        .map((reason) => reason.error),
    ).toContainEqual(
      expect.objectContaining({
        _tag: "OpenCodeDriverError",
        operation: "tools.connect",
      }),
    )
  }),
)

it.live("returns structured evidence from the safe lifecycle boundary", () =>
  Effect.gen(function* () {
    const result = yield* OpenCodeDriver.useReport(
      {
        keepArtifacts: true,
        opencode: { command: fakeOpenCode },
      },
      ({ artifacts }) => Effect.succeed(artifacts),
    )

    expect(result.value).toBe(result.report.artifacts)
    expect(result.report).toMatchObject({
      artifacts: result.value,
      retained: true,
      recordings: [],
      compatibility: [
        { _tag: "Negotiated", role: "backend", protocolVersion: 1 },
        { _tag: "Negotiated", role: "ui", protocolVersion: 1 },
      ],
    })
    yield* Effect.promise(() => rm(result.value, { recursive: true, force: true }))
  }),
)

it.live("settles and exports recordings when the user program fails", () =>
  Effect.gen(function* () {
    let artifacts = ""
    let recording = ""
    const result = yield* Effect.exit(
      OpenCodeDriver.use(
        {
          keepArtifacts: true,
          tui: { recording: true },
          opencode: { command: fakeOpenCode },
        },
        (driver) => {
          artifacts = driver.artifacts
          recording = driver.tui.recording?.path ?? ""
          return Effect.fail("user program failed")
        },
      ),
    )

    yield* Effect.addFinalizer(() =>
      Effect.promise(async () => {
        await rm(artifacts, { recursive: true, force: true })
        await rm(recording, { force: true })
      }),
    )

    expect(Exit.isFailure(result)).toBe(true)
    expect(yield* exists(recording)).toBe(true)
    for (const file of ["service.pid", "child.pid"]) {
      const pid = Number(
        yield* Effect.promise(() =>
          readFile(`${artifacts}/${file}`, "utf8"),
        ),
      )
      expect(isRunning(pid)).toBe(false)
    }
  }),
)

it.live("preserves user and settlement failures", () =>
  Effect.gen(function* () {
    let artifacts = ""
    const result = yield* Effect.exit(
      OpenCodeDriver.use(
        {
          keepArtifacts: true,
          tui: { recording: true },
          opencode: { command: fakeOpenCode },
        },
        (driver) =>
          Effect.gen(function* () {
            artifacts = driver.artifacts
            yield* Effect.promise(async () => {
              const directory = `${driver.artifacts}/drive`
              for (const file of await readdir(directory)) {
                if (!file.endsWith(".json")) continue
                const manifest: unknown = JSON.parse(
                  await readFile(`${directory}/${file}`, "utf8"),
                )
                if (
                  typeof manifest === "object" &&
                  manifest !== null &&
                  "recording" in manifest &&
                  typeof manifest.recording === "object" &&
                  manifest.recording !== null &&
                  "timeline" in manifest.recording &&
                  typeof manifest.recording.timeline === "string"
                )
                  await rm(manifest.recording.timeline, { force: true })
              }
            })
            return yield* Effect.fail("user program failed")
          }),
      ),
    )

    yield* Effect.addFinalizer(() =>
      Effect.promise(() => rm(artifacts, { recursive: true, force: true })),
    )
    if (Exit.isSuccess(result))
      return yield* Effect.dieMessage("driver unexpectedly succeeded")
    const failures = result.cause.reasons
      .filter(Cause.isFailReason)
      .map((reason) => reason.error)
    expect(failures).toContain("user program failed")
    expect(failures).toContainEqual(
      expect.objectContaining({
        _tag: "OpenCodeDriverError",
        operation: "recording.export",
      }),
    )
  }),
)

it.live("interrupts use when the backend disconnects", () =>
  Effect.gen(function* () {
    let artifacts = ""
    const result = yield* Effect.exit(
      OpenCodeDriver.use(
        {
          keepArtifacts: true,
          opencode: { command: fakeOpenCode },
        },
        (driver) =>
          Effect.gen(function* () {
            artifacts = driver.artifacts
            yield* driver.tools.attach({
              tools: [
                {
                  name: "lookup",
                  description: "Look up a value",
                  inputSchema: { type: "object" },
                  options: { codemode: false },
                },
              ],
            })
            const pid = Number(
              yield* Effect.promise(() =>
                readFile(`${artifacts}/service.pid`, "utf8"),
              ),
            )
            process.kill(pid, "SIGKILL")
            return yield* Effect.never
          }),
      ).pipe(
        Effect.timeoutOrElse({
          duration: 10_000,
          orElse: () => Effect.dieMessage("backend disconnect was not observed"),
        }),
      ),
    )

    yield* Effect.addFinalizer(() =>
      Effect.promise(() => rm(artifacts, { recursive: true, force: true })),
    )
    if (Exit.isSuccess(result))
      return yield* Effect.dieMessage("driver unexpectedly succeeded")
    expect(Cause.squash(result.cause)).toMatchObject({
      _tag: "LlmControllerError",
      operation: "backend",
    })
  }),
)

it.live("closes TUIs and exports recordings after LLM settlement fails", () =>
  Effect.gen(function* () {
    let artifacts = ""
    let recording = ""
    yield* Effect.scoped(
      Effect.gen(function* () {
        const driver = yield* OpenCodeDriver.make({
          keepArtifacts: true,
          tui: { recording: true },
          opencode: { command: fakeOpenCode },
        })
        artifacts = driver.artifacts
        recording = driver.tui.recording?.path ?? ""
        yield* driver.llm.queue(
          Llm.finish(),
          Llm.text("too late", { delay: 0 }),
        )
        yield* driver.ui.submit("trigger invalid response")
        const failure = yield* driver.settle().pipe(Effect.flip)
        expect(failure).toMatchObject({
          _tag: "LlmControllerError",
          operation: "respond",
        })
        expect(yield* exists(recording)).toBe(true)
        expect(
          (yield* driver.tuis.launch().pipe(Effect.flip)).operation,
        ).toBe("tui.launch")
      }),
    )

    yield* Effect.addFinalizer(() =>
      Effect.promise(async () => {
        await rm(artifacts, { recursive: true, force: true })
        await rm(recording, { force: true })
      }),
    )
    for (const file of ["service.pid", "child.pid"]) {
      const pid = Number(
        yield* Effect.promise(() =>
          readFile(`${artifacts}/${file}`, "utf8"),
        ),
      )
      expect(isRunning(pid)).toBe(false)
    }
  }),
)

it.live("force kills unresponsive processes and preserves their logs", () =>
  Effect.gen(function* () {
    const started = Date.now()
    const artifacts = yield* OpenCodeDriver.use(
      {
        keepArtifacts: true,
        opencode: {
          command: [...fakeOpenCode, "ignore-sigterm", "write-stdio"],
        },
      },
      (driver) =>
        driver.llm.queue(
          Llm.text("shutdown response", { delay: 0, chunkSize: 100 }),
        ).pipe(Effect.as(driver.artifacts)),
    )
    const elapsed = Date.now() - started

    yield* Effect.addFinalizer(() =>
      Effect.promise(() => rm(artifacts, { recursive: true, force: true })),
    )

    expect(
      yield* Effect.promise(() =>
        readFile(`${artifacts}/logs/service.stdout.log`, "utf8"),
      ),
    ).toContain("fake opencode service stdout")
    expect(
      yield* Effect.promise(() =>
        readFile(`${artifacts}/logs/tui-0.stderr.log`, "utf8"),
      ),
    ).toContain("fake opencode client stderr")
    expect(elapsed).toBeGreaterThanOrEqual(900)
    expect(elapsed).toBeLessThan(10_000)
    for (const file of ["service.pid", "child.pid"]) {
      const pid = Number(
        yield* Effect.promise(() =>
          readFile(`${artifacts}/${file}`, "utf8"),
        ),
      )
      expect(isRunning(pid)).toBe(false)
    }
  }),
)

const exists = (path: string) =>
  Effect.promise(() => stat(path).then(() => true, () => false))

function isRunning(pid: number) {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}
