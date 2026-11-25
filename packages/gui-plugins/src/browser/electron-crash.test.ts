import { expect, test } from "bun:test"
import path from "node:path"
import { runElectronFixture } from "./electron-run"

type Line = { readonly level: string; readonly message: string; readonly data: Readonly<Record<string, string | number | boolean>> }

type Ended = {
  /** Electron's own events for the page, in order. */
  readonly signals: readonly string[]
  /** What the page told the pane. */
  readonly ends: readonly { readonly cause: string; readonly reason?: string; readonly exitCode?: number }[]
  /** What an agent's command on the tab hears. */
  readonly failure: string
}

// Why a tab's page ended is known only from Electron's `render-process-gone`, which the pinned Chromium raises a moment
// after its debugger's `Inspector.targetCrashed`. This ends real renderers in the pinned Electron, so a page that ends
// without its reason in the desktop log, with two lines, or with its address in one, fails here; so does an upgrade
// that changes which signals a crash raises. Chromium reports a stalled page only without a debugger and after 15 s,
// so the stall lines are covered in page-log.test.ts.
test(
  "a page whose process ends is logged once with Electron's reason and exit code and its origin only, and the agent hears the reason",
  async () => {
    const result: {
      origin: string
      refused: string
      lines: Line[]
      crashed: Ended
      killed: Ended
      disposed: Pick<Ended, "signals" | "ends">
      child: string
      gone: string[]
      platform: string
    } = JSON.parse(await runElectronFixture({ fixture: path.join(import.meta.dir, "electron-crash.fixture.ts") }))

    const lines = (message: string, tab?: string) => result.lines.filter((line) => line.message === message && (!tab || line.data.tab === tab))

    // A renderer crash via DevTools Page.crash: one line, although the debugger, the process and the debugger's detach each reported it.
    expect(result.crashed.signals.filter((signal) => signal.startsWith("render-process-gone"))).toEqual(["render-process-gone crashed " + result.crashed.ends[0]?.exitCode])
    expect(result.crashed.ends).toMatchObject([{ cause: "renderer-gone", reason: "crashed" }])
    const crashed = lines("browser page ended", "tab_11111111-1111-1111-1111-111111111111")
    expect(crashed.length).toBe(1)
    expect(crashed[0]).toMatchObject({
      level: "error",
      data: {
        cause: "renderer-gone",
        reason: "crashed",
        exitCode: result.crashed.ends[0]?.exitCode,
        origin: result.origin,
        agentDriven: true,
        loading: false,
        // The last command that ran on the tab, by name.
        operation: "snapshot",
        operationBy: "agent",
        operationRunning: false,
      },
    })
    // The process's memory as the pane last noted it: Electron lists none for a process that is gone.
    expect(crashed[0]?.data.workingSetKB).toBeGreaterThan(0)
    expect(crashed[0]?.data.openMs).toBeGreaterThanOrEqual(0)

    if (result.platform === "win32") expect(crashed[0]?.data.exitCodeHex).toMatch(/^0x[0-9A-F]{8}$/)
    expect(result.crashed.failure).toContain("This tab's page process ended: it crashed (exit code " + result.crashed.ends[0]?.exitCode)
    expect(result.crashed.failure).toContain("browser.reload({tabID})")

    // A kill from outside: the line carries whatever reason and exit code Electron gave, which differ by system.
    const [signal, reason, exitCode] = result.killed.signals.find((entry) => entry.startsWith("render-process-gone"))?.split(" ") ?? []
    expect(signal).toBe("render-process-gone")
    const killed = lines("browser page ended", "tab_22222222-2222-2222-2222-222222222222")
    expect(killed.length).toBe(1)
    expect(killed[0]?.data).toMatchObject({ cause: "renderer-gone", reason, exitCode: Number(exitCode), origin: result.origin })
    expect(result.killed.failure).toContain("exit code " + exitCode)

    // A load that fails: once for the tab's one navigation, by Chromium's error.
    const failed = lines("browser page load failed", "tab_33333333-3333-3333-3333-333333333333")
    expect(failed.length).toBe(1)
    expect(failed[0]).toMatchObject({ level: "warn", data: { code: -102, error: "ERR_CONNECTION_REFUSED", origin: result.refused } })

    // A healthy tab closed normally: no page-end callback and no "browser page ended" log line.
    expect(result.disposed.ends).toEqual([])
    expect(lines("browser page ended", "tab_44444444-4444-4444-4444-444444444444")).toEqual([])

    // The child process the fixture ended, as Electron reported it. Another one may end by itself on a loaded runner.
    const child = lines("browser child process gone").find((line) => line.data.type === result.child)
    expect(child).toMatchObject({ level: "error", data: { pages: 0 } })
    expect(result.gone).toContain([child?.data.type, child?.data.reason, child?.data.exitCode].join(" "))

    // Nothing of the address beyond its origin, and nothing of the page, in any line or in what the agent hears.
    expect(JSON.stringify([result.lines, result.crashed.failure, result.killed.failure])).not.toMatch(/mail|inbox|alex|token|s3cret|message-42|Payroll|493817/i)
  },
  // Starting Electron takes seconds on a loaded runner.
  60_000,
)
