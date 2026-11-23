import { afterEach, beforeEach, describe, expect, jest, test } from "bun:test"
import {
  createRecoveryDriver,
  EXPORT_TIMEOUT_MS,
  formatUnresponsiveSamples,
  initialRecoveryState,
  SAMPLE_INTERVAL_MS,
  SAMPLE_PERIOD_MS,
  selectDialog,
  transitionRecovery,
  type RecoveryAction,
  type RecoveryCommand,
  type RecoveryDialogView,
  type RecoveryErrorKind,
  type RecoveryEvent,
  type RecoveryState,
} from "./recovery-machine"

// Folds events through the machine and keeps the commands of each step.
function replay(events: readonly RecoveryEvent[], from = initialRecoveryState()) {
  return events.reduce<{ state: RecoveryState; commands: (readonly RecoveryCommand[])[] }>(
    (result, event) => {
      const next = transitionRecovery(result.state, event)

      return { state: next.state, commands: [...result.commands, next.commands] }
    },
    { state: from, commands: [] },
  )
}

// The event that answers the dialog open in `state`, as the driver builds it from the button index.
function respond(state: RecoveryState, action: RecoveryAction): RecoveryEvent {
  return { type: "dialog.responded", attempt: attemptOf(state), action }
}

function attemptOf(state: RecoveryState) {
  if (state.status === "closed") throw new Error("closed state has no attempt")

  return state.attempt
}

const unresponsive: RecoveryEvent = { type: "renderer.unresponsive", devtoolsOpen: false }

const responsive: RecoveryEvent = { type: "renderer.responsive" }

const crashed: RecoveryEvent = { type: "process.gone", reason: "crashed", exitCode: 1 }

const loadFailed: RecoveryEvent = {
  type: "load.failed",
  url: "oc://renderer/index.html",
  code: -105,
  description: "ERR_NAME_NOT_RESOLVED",
  isMainFrame: true,
}

const sampleStart = (attempt: number): RecoveryCommand[] => [
  { type: "start-sample-tick", attempt },
  { type: "start-sample-window", attempt },
]

const incidentOf = (state: RecoveryState) => selectDialog(state)?.incident.kind

describe("window recovery", () => {
  test("a crash replaces an open unresponsive dialog and drops its late answer", () => {
    const hung = replay([
      unresponsive,
      { type: "sample.tick", attempt: 1 },
      { type: "sample.collected", attempt: 1, stack: "stackA" },
    ])

    const gone = transitionRecovery(hung.state, crashed)

    expect(selectDialog(hung.state)?.actions).toEqual(["relaunch", "export-logs", "keep-waiting"])
    expect(gone.commands).toEqual([
      { type: "cancel-sample-timers" },
      { type: "flush-samples", samples: new Map([["stackA", 1]]) },
      { type: "close-dialog", attempt: 2 },
      { type: "reveal" },
      { type: "open-dialog", attempt: 3 },
    ])
    expect(selectDialog(gone.state)?.actions).toEqual(["relaunch", "export-logs", "quit"])

    const late = transitionRecovery(gone.state, respond(hung.state, "keep-waiting"))

    expect(late.state).toBe(gone.state)
    expect(late.commands).toEqual([])
  })

  test.each([
    ["a load failure replaces an unresponsive dialog", unresponsive, loadFailed, "load-failed"],
    ["a crash replaces a load-failure dialog", loadFailed, crashed, "terminated"],
    ["a crash replaces an unresponsive dialog", unresponsive, crashed, "terminated"],
  ] as const)("%s", (_name, first, second, kind) => {
    const result = replay([first, second])

    expect(incidentOf(result.state)).toBe(kind)
    expect(result.commands[1]).toContainEqual({ type: "close-dialog", attempt: attemptOf(result.state) - 1 })
    expect(result.commands[1]).toContainEqual({ type: "open-dialog", attempt: attemptOf(result.state) })
  })

  test.each([
    ["a hang during a load-failure dialog", loadFailed, unresponsive],
    ["a hang during a crash dialog", crashed, unresponsive],
    ["a load failure during a crash dialog", crashed, loadFailed],
    ["a second hang during an unresponsive dialog", unresponsive, unresponsive],
    ["a second load failure during a load-failure dialog", loadFailed, loadFailed],
  ] as const)("ignores %s", (_name, first, second) => {
    const open = replay([first]).state
    const result = transitionRecovery(open, second)

    expect(result.state).toBe(open)
    expect(result.commands).toEqual([])
  })

  test("a crash during a log export opens the crash dialog once the export settles", () => {
    const hung = replay([unresponsive]).state
    const exporting = replay([respond(hung, "export-logs"), crashed], hung).state

    expect(exporting).toMatchObject({ status: "exporting", resumeSampling: false, incident: { kind: "terminated" } })

    const settled = transitionRecovery(exporting, {
      type: "export.succeeded",
      attempt: attemptOf(exporting),
      devtoolsOpen: false,
    })

    expect(incidentOf(settled.state)).toBe("terminated")
    expect(settled.commands).toEqual([
      { type: "cancel-export-timeout" },
      { type: "reveal" },
      { type: "open-dialog", attempt: attemptOf(exporting) + 1 },
    ])
  })

  test("a renderer that recovers during a log export gets no dialog or sampler afterwards", () => {
    const hung = replay([unresponsive]).state
    const exporting = replay([respond(hung, "export-logs"), responsive], hung).state

    const settled = transitionRecovery(exporting, {
      type: "export.succeeded",
      attempt: attemptOf(exporting),
      devtoolsOpen: false,
    })

    expect(settled.state).toEqual({ status: "idle", attempt: attemptOf(exporting) })
    expect(settled.commands).toEqual([{ type: "cancel-export-timeout" }])
  })

  test.each([
    ["restarts the sampler", false, true],
    ["skips the sampler with DevTools open", true, false],
  ] as const)("a still-hung renderer reopens its dialog after a log export and %s", (_name, devtoolsOpen, sampled) => {
    const hung = replay([unresponsive]).state
    const exporting = transitionRecovery(hung, respond(hung, "export-logs")).state
    const attempt = attemptOf(exporting)
    const settled = transitionRecovery(exporting, { type: "export.succeeded", attempt, devtoolsOpen })

    expect(incidentOf(settled.state)).toBe("unresponsive")
    expect(settled.commands).toEqual([
      { type: "cancel-export-timeout" },
      ...(sampled ? sampleStart(attempt + 1) : []),
      { type: "reveal" },
      { type: "open-dialog", attempt: sampled ? attempt + 2 : attempt + 1 },
    ])
  })

  test("closes the unresponsive dialog when the renderer recovers", () => {
    const result = replay([unresponsive, responsive])

    expect(result.state).toEqual({ status: "idle", attempt: 2 })
    expect(result.commands[1]).toEqual([{ type: "cancel-sample-timers" }, { type: "close-dialog", attempt: 2 }])
  })

  test.each([
    ["load-failure", loadFailed],
    ["crash", crashed],
  ] as const)("keeps the %s dialog open when the renderer reports responsive", (_name, incident) => {
    const open = replay([incident]).state
    const result = transitionRecovery(open, responsive)

    expect(result.state).toBe(open)
    expect(result.commands).toEqual([])
  })

  test("drops a stack from an earlier hang that resolves during the next one", () => {
    const second = replay([unresponsive, { type: "sample.tick", attempt: 1 }, responsive, unresponsive])

    expect(second.state).toMatchObject({ status: "dialog", attempt: 4, sample: { attempt: 3, collecting: false } })
    expect(second.commands[3]).toEqual([...sampleStart(3), { type: "reveal" }, { type: "open-dialog", attempt: 4 }])

    const stale = replay(
      [
        { type: "sample.collected", attempt: 1, stack: "stale" },
        { type: "sample.failed", attempt: 1, error: new Error("frame gone") },
      ],
      second.state,
    )

    expect(stale.state).toBe(second.state)
    expect(stale.commands.flat()).toEqual([])

    const fresh = replay(
      [
        { type: "sample.tick", attempt: 3 },
        { type: "sample.collected", attempt: 3, stack: "fresh" },
      ],
      second.state,
    )

    expect(fresh.state).toMatchObject({ sample: { samples: new Map([["fresh", 1]]) } })
  })

  test("a failed log export logs and reopens the dialog", () => {
    const open = replay([crashed]).state
    const exporting = transitionRecovery(open, respond(open, "export-logs")).state
    const error = new Error("disk full")

    const failed = transitionRecovery(exporting, {
      type: "export.failed",
      attempt: attemptOf(exporting),
      error,
      devtoolsOpen: false,
    })

    expect(incidentOf(failed.state)).toBe("terminated")
    expect(failed.commands).toEqual([
      { type: "cancel-export-timeout" },
      { type: "log-error", kind: "export", error },
      { type: "reveal" },
      { type: "open-dialog", attempt: attemptOf(exporting) + 1 },
    ])
  })

  test("a hung log export times out, reopens the dialog and drops the late result", () => {
    const open = replay([crashed]).state
    const exporting = transitionRecovery(open, respond(open, "export-logs"))

    expect(exporting.commands).toEqual([
      { type: "export-logs", attempt: attemptOf(exporting.state) },
      { type: "start-export-timeout", attempt: attemptOf(exporting.state) },
    ])

    const timedOut = transitionRecovery(exporting.state, {
      type: "export.timed-out",
      attempt: attemptOf(exporting.state),
      devtoolsOpen: false,
    })

    expect(incidentOf(timedOut.state)).toBe("terminated")
    expect(timedOut.commands).toEqual([
      { type: "log-error", kind: "export-timeout" },
      { type: "reveal" },
      { type: "open-dialog", attempt: attemptOf(exporting.state) + 1 },
    ])

    const late = transitionRecovery(timedOut.state, {
      type: "export.succeeded",
      attempt: attemptOf(exporting.state),
      devtoolsOpen: false,
    })

    expect(late.state).toBe(timedOut.state)
  })

  test("keeps sampling after Keep Waiting and logs the stacks when the sampling period ends", () => {
    const hung = replay([
      unresponsive,
      { type: "sample.tick", attempt: 1 },
      { type: "sample.collected", attempt: 1, stack: "a" },
    ]).state

    const result = replay(
      [
        respond(hung, "keep-waiting"),
        { type: "sample.tick", attempt: 1 },
        { type: "sample.collected", attempt: 1, stack: "b" },
        { type: "sample.tick", attempt: 1 },
        { type: "sample.collected", attempt: 1, stack: "a" },
        { type: "sample.window-elapsed", attempt: 1 },
      ],
      hung,
    )

    const samples = new Map([
      ["a", 2],
      ["b", 1],
    ])

    expect(result.commands[0]).toEqual([])
    expect(result.state).toEqual({ status: "idle", attempt: 2 })
    expect(result.commands.at(-1)).toEqual([{ type: "cancel-sample-timers" }, { type: "flush-samples", samples }])
    expect(
      formatUnresponsiveSamples(
        "main",
        "oc://renderer/",
        new Map([
          ["b", 1],
          ["a", 2],
        ]),
      ),
    ).toBe(
      [
        "renderer unresponsive samples",
        "Window: main",
        "URL: oc://renderer/",
        "<2> a",
        "<1> b",
        "Total Samples: 3",
      ].join("\n"),
    )
  })

  test("a log export after the sampling period ended does not start another sampler", () => {
    const hung = replay([unresponsive, { type: "sample.window-elapsed", attempt: 1 }]).state
    const exporting = transitionRecovery(hung, respond(hung, "export-logs")).state

    expect(exporting).toMatchObject({ status: "exporting", resumeSampling: false })

    const settled = transitionRecovery(exporting, {
      type: "export.succeeded",
      attempt: attemptOf(exporting),
      devtoolsOpen: false,
    })

    expect(settled.commands.filter((command) => command.type === "start-sample-window")).toEqual([])
  })

  test.each([
    ["a sub-frame load failure", { ...loadFailed, isMainFrame: false }],
    ["an aborted navigation", { ...loadFailed, code: -3 }],
  ] as const)("ignores %s", (_name, event) => {
    const idle = initialRecoveryState()
    const result = transitionRecovery(idle, event)

    expect(result.state).toBe(idle)
    expect(result.commands).toEqual([])
  })

  test.each([
    ["Relaunch", "relaunch", [{ type: "relaunch" }]],
    ["Quit", "quit", [{ type: "quit" }]],
  ] as const)("%s ends recovery and ignores every later event", (_name, action, commands) => {
    const open = replay([crashed]).state
    const closed = transitionRecovery(open, respond(open, action))
    const after = replay([unresponsive, crashed, loadFailed, responsive, { type: "window.closed" }], closed.state)

    expect(closed.state).toEqual({ status: "closed" })
    expect(closed.commands).toEqual(commands)
    expect(after.state).toBe(closed.state)
    expect(after.commands.flat()).toEqual([])
  })

  test.each([
    [
      "an unresponsive dialog",
      [unresponsive],
      [{ type: "cancel-sample-timers" }, { type: "close-dialog", attempt: 2 }],
    ],
    [
      "sampling after Keep Waiting",
      [unresponsive, respond(replay([unresponsive]).state, "keep-waiting")],
      [{ type: "cancel-sample-timers" }],
    ],
    ["a log export", [crashed, respond(replay([crashed]).state, "export-logs")], [{ type: "cancel-export-timeout" }]],
  ] satisfies [string, RecoveryEvent[], RecoveryCommand[]][])(
    "a window that closes during %s stops its work",
    (_name, events, commands) => {
      const result = replay([...events, { type: "window.closed" }])

      expect(result.state).toEqual({ status: "closed" })
      expect(result.commands.at(-1)).toEqual(commands)
    },
  )
})

describe("window recovery driver", () => {
  beforeEach(() => {
    jest.useFakeTimers()
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  // The driver chains dialogs, exports and samples through promises; let those callbacks run.
  const settle = async () => {
    for (const _ of Array.from({ length: 20 })) await Promise.resolve()
  }

  function setup(options: { readonly exportLogs?: () => Promise<void> } = {}) {
    const calls: string[] = []
    const errors: RecoveryErrorKind[] = []
    const flushed: ReadonlyMap<string, number>[] = []
    const dialogs: { view: RecoveryDialogView; signal: AbortSignal; resolve: (response: number) => void }[] = []
    const window = { destroyed: false }

    const driver = createRecoveryDriver({
      reveal: () => calls.push("reveal"),
      showDialog: (view, signal) => {
        const response = Promise.withResolvers<number>()
        calls.push(`show:${view.incident.kind}`)
        dialogs.push({ view, signal, resolve: response.resolve })

        return response.promise
      },
      exportLogs: options.exportLogs ?? (() => Promise.resolve()),
      collectSample: () => Promise.resolve("stack"),
      flushSamples: (samples) => flushed.push(samples),
      logError: (failure) => errors.push(failure.kind),
      isDevToolsOpen: () => false,
      isDestroyed: () => window.destroyed,
      relaunch: () => calls.push("relaunch"),
      quit: () => calls.push("quit"),
    })

    return { driver, calls, errors, flushed, dialogs, window }
  }

  test("reveals the window first and opens a crash dialog only after the replaced one dismissed", async () => {
    const recovery = setup()

    recovery.driver.dispatch(unresponsive)
    await settle()
    expect(recovery.calls).toEqual(["reveal", "show:unresponsive"])

    recovery.driver.dispatch(crashed)
    await settle()
    expect(recovery.dialogs[0].signal.aborted).toBe(true)
    expect(recovery.calls).toEqual(["reveal", "show:unresponsive", "reveal"])

    // An aborted message box resolves as if cancelled, here with Keep Waiting.
    recovery.dialogs[0].resolve(2)
    await settle()
    expect(recovery.calls).toEqual(["reveal", "show:unresponsive", "reveal", "show:terminated"])
    expect(selectDialog(recovery.driver.state())?.incident.kind).toBe("terminated")
  })

  test("does not quit the app when the window closing dismisses a crash dialog", async () => {
    const recovery = setup()

    recovery.driver.dispatch(crashed)
    await settle()
    recovery.window.destroyed = true
    recovery.dialogs[0].resolve(2)
    await settle()

    expect(recovery.driver.state()).toEqual({ status: "closed" })
    expect(recovery.calls).not.toContain("quit")
  })

  test("samples once a second and logs the stacks when the sampling period ends", async () => {
    const recovery = setup()

    recovery.driver.dispatch(unresponsive)

    for (const _ of Array.from({ length: SAMPLE_PERIOD_MS / SAMPLE_INTERVAL_MS })) {
      jest.advanceTimersByTime(SAMPLE_INTERVAL_MS)
      await settle()
    }

    expect(recovery.flushed).toEqual([new Map([["stack", SAMPLE_PERIOD_MS / SAMPLE_INTERVAL_MS - 1]])])
    expect(selectDialog(recovery.driver.state())?.incident.kind).toBe("unresponsive")
    expect(jest.getTimerCount()).toBe(0)
  })

  test("reopens the dialog when a log export hangs", async () => {
    const recovery = setup({ exportLogs: () => new Promise(() => {}) })

    recovery.driver.dispatch(crashed)
    await settle()
    recovery.dialogs[0].resolve(1)
    await settle()
    jest.advanceTimersByTime(EXPORT_TIMEOUT_MS)
    await settle()

    expect(recovery.errors).toEqual(["export-timeout"])
    expect(recovery.calls.filter((call) => call === "show:terminated")).toHaveLength(2)
    expect(jest.getTimerCount()).toBe(0)
  })

  test.each([
    ["the renderer recovers", responsive],
    ["the window closes", { type: "window.closed" }],
  ] satisfies [string, RecoveryEvent][])("stops sampling and closes the dialog when %s", async (_name, event) => {
    const recovery = setup()

    recovery.driver.dispatch(unresponsive)
    await settle()
    recovery.driver.dispatch(event)
    await settle()

    expect(recovery.dialogs[0].signal.aborted).toBe(true)
    expect(jest.getTimerCount()).toBe(0)
  })
})
