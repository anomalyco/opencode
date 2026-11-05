import { describe, expect, test } from "bun:test"
import {
  DISPOSED_ERROR,
  initialLoggingState,
  transitionLogging,
  type ExportReply,
  type LoggingEvent,
  type LoggingState,
  type LoggingTransition,
} from "./logging-machine"

const reply = (): ExportReply => ({ resolve: () => {}, reject: () => {} })

const netlog = "/logs/run/network.netlog"

const replay = (events: readonly LoggingEvent[], from: LoggingState = initialLoggingState()) =>
  events.reduce<LoggingTransition>(
    (result, event) => {
      const next = transitionLogging(result.state, event)

      return { state: next.state, commands: [...result.commands, ...next.commands] }
    },
    { state: from, commands: [] },
  )

const logging = replay([
  { type: "network.requested" },
  { type: "netlog.started", attempt: 1, path: netlog },
]).state

describe("logging machine", () => {
  test("exports while NetLog runs stop it once, write one archive, settle every caller and restart it once", () => {
    const first = reply()
    const second = reply()
    const third = reply()

    const result = replay(
      [
        { type: "export.requested", reply: first },
        { type: "export.requested", reply: second },
        { type: "netlog.stopped", attempt: 2 },
        { type: "export.requested", reply: third },
        { type: "archive.succeeded", attempt: 3, output: "/downloads/opencode-debug.zip" },
        { type: "netlog.started", attempt: 4, path: netlog },
      ],
      logging,
    )

    expect(result.commands).toEqual([
      { type: "stop-netlog", attempt: 2 },
      { type: "write-archive", attempt: 3, netLogPath: netlog },
      { type: "resolve-export", replies: [first, second, third], output: "/downloads/opencode-debug.zip" },
      { type: "start-netlog", attempt: 4, mode: "restart" },
    ])
    expect(result.state).toEqual({ status: "idle", attempt: 4, netLog: "active", netLogPath: netlog })
  })

  test("NetLog asked for during an export starts once the archive is written, not while it reads the files", () => {
    const caller = reply()

    const archiving = replay([{ type: "export.requested", reply: caller }, { type: "network.requested" }])
    expect(archiving.commands).toEqual([{ type: "write-archive", attempt: 1, netLogPath: undefined }])

    const result = replay(
      [
        { type: "archive.succeeded", attempt: 1, output: "/out.zip" },
        { type: "netlog.started", attempt: 2, path: netlog },
      ],
      archiving.state,
    )

    expect(result.commands).toEqual([
      { type: "resolve-export", replies: [caller], output: "/out.zip" },
      { type: "start-netlog", attempt: 2, mode: "restart" },
    ])
    expect(result.state).toEqual({ status: "idle", attempt: 2, netLog: "active", netLogPath: netlog })
  })

  test("an export asked for while NetLog starts waits for it, then stops it before archiving", () => {
    const caller = reply()

    const result = replay([
      { type: "network.requested" },
      { type: "export.requested", reply: caller },
      { type: "netlog.started", attempt: 1, path: netlog },
    ])

    expect(result.commands).toEqual([
      { type: "start-netlog", attempt: 1, mode: "start" },
      { type: "stop-netlog", attempt: 2 },
    ])
    expect(result.state).toMatchObject({ status: "stopping-netlog", netLogPath: netlog, exports: [caller] })
  })

  test("a NetLog that never started is not stopped and not named in the manifest", () => {
    const caller = reply()

    const result = replay([
      { type: "network.requested" },
      { type: "netlog.start-failed", attempt: 1 },
      { type: "export.requested", reply: caller },
    ])

    expect(result.commands).toEqual([
      { type: "start-netlog", attempt: 1, mode: "start" },
      { type: "write-archive", attempt: 2, netLogPath: undefined },
    ])
  })

  test("a failed or timed-out archive rejects its callers and still restarts NetLog", () => {
    const caller = reply()
    const error = new Error("Debug log export timed out")

    const result = replay(
      [
        { type: "export.requested", reply: caller },
        { type: "netlog.stopped", attempt: 2 },
        { type: "archive.failed", attempt: 3, error },
      ],
      logging,
    )

    expect(result.commands.slice(-2)).toEqual([
      { type: "reject-export", replies: [caller], error },
      { type: "start-netlog", attempt: 4, mode: "restart" },
    ])
  })

  test("a caller that leaves keeps the export running for the others", () => {
    const leaving = reply()
    const staying = reply()

    const archiving = replay([
      { type: "export.requested", reply: leaving },
      { type: "export.requested", reply: staying },
      { type: "export.cancelled", reply: leaving },
    ]).state

    expect(archiving).toMatchObject({ status: "archiving", exports: [staying] })
    expect(transitionLogging(archiving, { type: "export.cancelled", reply: leaving }).state).toBe(archiving)
    expect(transitionLogging(archiving, { type: "archive.succeeded", attempt: 1, output: "/out.zip" }).commands).toEqual([
      { type: "resolve-export", replies: [staying], output: "/out.zip" },
    ])
  })

  test.each([
    { name: "a NetLog result while idle", events: [], stale: { type: "netlog.started", attempt: 0, path: netlog } },
    {
      name: "an archive result from an earlier attempt",
      events: [{ type: "export.requested", reply: reply() }, { type: "network.requested" }],
      stale: { type: "archive.succeeded", attempt: 0, output: "/old.zip" },
    },
    {
      name: "a stop result while archiving",
      events: [{ type: "export.requested", reply: reply() }],
      stale: { type: "netlog.stopped", attempt: 1 },
    },
    { name: "a repeated NetLog request while it runs", events: [], stale: { type: "network.requested" }, from: logging },
  ] satisfies { name: string; events: LoggingEvent[]; stale: LoggingEvent; from?: LoggingState }[])(
    "$name is ignored",
    (row) => {
      const state = replay(row.events, row.from).state

      expect(transitionLogging(state, row.stale)).toEqual({ state, commands: [] })
    },
  )

  test("disposal rejects pending exports, and later exports and results", () => {
    const pending = reply()
    const late = reply()

    const disposed = replay([{ type: "export.requested", reply: pending }, { type: "disposed" }], logging)
    expect(disposed.state).toEqual({ status: "disposed" })
    expect(disposed.commands).toEqual([
      { type: "stop-netlog", attempt: 2 },
      { type: "reject-export", replies: [pending], error: DISPOSED_ERROR },
    ])

    expect(transitionLogging(disposed.state, { type: "export.requested", reply: late }).commands).toEqual([
      { type: "reject-export", replies: [late], error: DISPOSED_ERROR },
    ])
    expect(transitionLogging(disposed.state, { type: "netlog.stopped", attempt: 2 }).state).toBe(disposed.state)
    expect(transitionLogging(disposed.state, { type: "network.requested" }).commands).toEqual([])
  })
})
