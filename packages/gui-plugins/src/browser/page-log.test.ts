import { afterEach, beforeEach, expect, jest, setSystemTime, test } from "bun:test"
import { createPageLog, exitCodeHex, logOrigin, PROCESS_ACCOUNT_MS, processMemory, setupFailure } from "./page-log"

// The desktop log goes into bug reports. Whatever a page's address holds beyond its origin must never reach it.
test.each([
  ["https://alex:pa55word@mail.example.com:8443/inbox/42?token=s3cret#message-7", "https://mail.example.com:8443"],
  ["https://outlook.example.com/mail/inbox/id/AAQkAGI?login_hint=alex%40example.com", "https://outlook.example.com"],
  ["http://localhost:3000/callback?code=4/0AbCd&state=s3cret", "http://localhost:3000"],
  ["HTTPS://Example.COM:443/Private", "https://example.com"],
  ["http://[::1]:5173/app?token=s3cret", "http://[::1]:5173"],
  ["wss://socket.example.com/stream?session=s3cret", "wss://socket.example.com"],
  ["file:///C:/Users/alex/Documents/payroll.html", "file"],
  ["file://server/share/alex/payroll.html", "file"],
  ["oc-preview://grant-7f3a9c/C:/Users/alex/repo/report.html?token=s3cret", "preview"],
  ["workspace:reports/alex/payroll.html", "preview"],
  ["artifact:ses_alex/payroll/index.html", "artifact"],
  ["about:blank", "about"],
  ["data:text/html,<p>alex s3cret</p>", "data"],
  ["blob:https://mail.example.com/5f0c7f3a-alex-s3cret", "blob:https://mail.example.com"],
  ["blob:null/5f0c7f3a-alex-s3cret", "blob"],
  ["chrome-extension://alexalexalexalexalexalexalexalex/popup.html?token=s3cret", "extension"],
  ["chrome-error://chromewebdata/", "error-page"],
  ["javascript:alert('alex s3cret')", "other"],
  ["mailto:alex@example.com?subject=s3cret", "other"],
  ["slack://channel?team=alex&id=s3cret", "other"],
  ["", "none"],
  ["alex s3cret is not an address", "invalid"],
  ["/mail/inbox/alex?token=s3cret", "invalid"],
  ["https://", "invalid"],
  ["http://exa mple.com/alex?token=s3cret", "invalid"],
])("the log names %p as %p", (address, origin) => {
  expect(logOrigin(address)).toBe(origin)
  expect(logOrigin(address)).not.toMatch(/alex|s3cret|pa55word|payroll|grant|inbox/i)
})

test("a Windows exit code reads as the NTSTATUS people search for", () => {
  expect(exitCodeHex(-1073741819)).toBe("0xC0000005")
  expect(exitCodeHex(-536870904)).toBe("0xE0000008")
  expect(exitCodeHex(3221225477)).toBe("0xC0000005")
  expect(exitCodeHex(1)).toBe("0x00000001")
})

test("a failed setup is logged by its error's name, code and Chromium command, never by its message", () => {
  const protocol = new Error("Inspect the tab. Chromium command Page.enable failed: no target for https://mail.example.com/inbox?token=s3cret")
  expect(setupFailure(protocol)).toEqual({ cause: "setup-failed", error: "Error", command: "Page.enable" })
  const load = Object.assign(new Error("ERR_NAME_NOT_RESOLVED (-105) loading 'https://mail.example.com/inbox?token=s3cret'"), { code: "ERR_NAME_NOT_RESOLVED" })
  expect(setupFailure(load)).toEqual({ cause: "setup-failed", error: "Error ERR_NAME_NOT_RESOLVED" })
  expect(setupFailure("https://mail.example.com/inbox?token=s3cret")).toEqual({ cause: "setup-failed", error: "not an Error" })
})

test("a process's memory is read from Electron's metrics only while it is listed", () => {
  const metrics = [
    { pid: 10, memory: { workingSetSize: 900, peakWorkingSetSize: 950, privateBytes: 400 } },
    { pid: 11, memory: { workingSetSize: 100, peakWorkingSetSize: 120 } },
  ]

  expect(processMemory(metrics, 10)).toEqual({ pid: 10, workingSetKB: 900, peakWorkingSetKB: 950, privateKB: 400 })
  expect(processMemory(metrics, 11)).toEqual({ pid: 11, workingSetKB: 100, peakWorkingSetKB: 120 })
  expect(processMemory(metrics, 12)).toBeUndefined()
})

const START = Date.parse("2026-11-20T03:44:00Z")

const address = "https://alex:pa55word@mail.example.com/inbox/42?token=s3cret#message-7"

type Line = { readonly level: string; readonly message: string; readonly data: object }

// One page's log over a page the test moves: its process is listed, with its memory, until the test ends it.
function page() {
  const lines: Line[] = []
  const processes = new Map([[10, { pid: 10, workingSetKB: 900, peakWorkingSetKB: 950, privateKB: 400 }]])

  const log = createPageLog({
    tab: "tab_1",
    write: (level, message, data) => lines.push({ level, message, data }),
    page: () => ({ address, agentDriven: true, loading: false }),
    memory: () => processes.get(10),
  })

  return { lines, processes, log }
}

beforeEach(() => {
  jest.useFakeTimers()
  setSystemTime(START)
})

afterEach(() => {
  jest.clearAllTimers()
  jest.useRealTimers()
  setSystemTime()
})

test("a crash the debugger reports before the process is one line with the process's reason and both signals", () => {
  const tab = page()
  setSystemTime(START + 60_000)
  const done = tab.log.operation("click", "agent")
  tab.log.sample(tab.processes.get(10))
  setSystemTime(START + 90_000)
  // The process is gone, so Electron lists its memory no more.
  tab.processes.clear()
  tab.log.end({ cause: "target-crashed" })
  expect(tab.lines).toEqual([])
  tab.log.end({ cause: "renderer-gone", reason: "oom", exitCode: -536870904 })
  tab.log.end({ cause: "debugger-detached", reason: "target closed" })
  done()
  jest.advanceTimersByTime(PROCESS_ACCOUNT_MS * 4)

  expect(tab.lines).toEqual([
    {
      level: "error",
      message: "browser page ended",
      data: {
        tab: "tab_1",
        cause: "renderer-gone",
        reason: "oom",
        exitCode: -536870904,
        ...(process.platform === "win32" && { exitCodeHex: "0xE0000008" }),
        first: "target-crashed",
        firstMs: 0,
        origin: "https://mail.example.com",
        agentDriven: true,
        openMs: 90_000,
        loading: false,
        operation: "click",
        operationBy: "agent",
        operationAgoMs: 30_000,
        operationRunning: true,
        pid: 10,
        workingSetKB: 900,
        peakWorkingSetKB: 950,
        privateKB: 400,
        memoryAgoMs: 30_000,
      },
    },
  ])
  expect(JSON.stringify(tab.lines)).not.toMatch(/alex|s3cret|pa55word|inbox|message-7/)
})

test.each([
  ["the process's report alone", [{ cause: "renderer-gone", reason: "crashed", exitCode: 2 }], "renderer-gone", 0],
  ["the process's report, then the debugger's", [{ cause: "renderer-gone", reason: "crashed", exitCode: 2 }, { cause: "target-crashed" }, { cause: "debugger-detached", reason: "target closed" }], "renderer-gone", 0],
  ["the debugger's report alone, once the process stayed silent", [{ cause: "target-crashed" }], "target-crashed", PROCESS_ACCOUNT_MS],
  ["a detached debugger, then a late report of the process", [{ cause: "debugger-detached", reason: "target closed" }, "wait", { cause: "renderer-gone", reason: "crashed", exitCode: 2 }], "debugger-detached", 0],
  ["a setup that failed, reported twice", [{ cause: "setup-failed", error: "Error", command: "Page.enable" }, { cause: "setup-failed", error: "Error", command: "Page.enable" }], "setup-failed", PROCESS_ACCOUNT_MS],
] as const)("a page that ends is logged once: %s", (_name, signals, cause, after) => {
  const tab = page()

  signals.forEach((signal) => {
    if (signal === "wait") return void jest.advanceTimersByTime(PROCESS_ACCOUNT_MS)
    void tab.log.end(signal)
  })
  expect(tab.lines.length).toBe(after ? 0 : 1)
  jest.advanceTimersByTime(PROCESS_ACCOUNT_MS)
  expect(tab.lines.map((line) => line.message)).toEqual(["browser page ended"])
  expect(tab.lines[0]?.data).toMatchObject({ tab: "tab_1", cause, origin: "https://mail.example.com" })
  expect(tab.log.ended()).toBe(true)
})

test("whichever signal of a crash comes first, the pane hears the process's own account, and the first signal when none comes", async () => {
  const detached = { cause: "debugger-detached", reason: "target closed" } as const
  const gone = { cause: "renderer-gone", reason: "oom", exitCode: -536870904 } as const

  // The debugger's detach before the process's report: both resolve to the process's reason, in one line.
  const reversed = page()
  const first = reversed.log.end(detached)
  const second = reversed.log.end(gone)
  expect(await first).toEqual(gone)
  expect(await second).toEqual(gone)
  expect(reversed.lines.map((line) => line.data)).toMatchObject([{ cause: "renderer-gone", reason: "oom", first: "debugger-detached" }])

  // The process's report first: a later detach hears it too.
  const ordered = page()
  expect(await ordered.log.end(gone)).toEqual(gone)
  expect(await ordered.log.end(detached)).toEqual(gone)

  // No report of the process: the wait ends, and the detach is what the page ended with.
  const silent = page()
  const waiting = silent.log.end(detached)
  jest.advanceTimersByTime(PROCESS_ACCOUNT_MS)
  expect(await waiting).toEqual(detached)
  expect(await silent.log.end(gone)).toEqual(detached)
  expect(silent.lines.map((line) => line.data)).toMatchObject([{ cause: "debugger-detached" }])
})

test("a page that answers again is logged, with the length of the stall when Chromium reported its start", () => {
  const tab = page()
  // Chromium does not report a stall's start while a debugger is attached, as the pane's always is.
  tab.log.responsive()
  setSystemTime(START + 5_000)
  tab.log.unresponsive()
  tab.log.unresponsive()
  setSystemTime(START + 23_000)
  tab.log.responsive()

  expect(tab.lines.map((line) => [line.level, line.message])).toEqual([
    ["warn", "browser page responsive"],
    ["warn", "browser page unresponsive"],
    ["warn", "browser page responsive"],
  ])
  expect(tab.lines[0]?.data).not.toHaveProperty("unresponsiveMs")
  expect(tab.lines[1]?.data).not.toHaveProperty("unresponsiveMs")
  expect(tab.lines[2]?.data).toMatchObject({ tab: "tab_1", origin: "https://mail.example.com", unresponsiveMs: 18_000, workingSetKB: 900, memoryAgoMs: 0 })
  // A page that ends while it stalls says for how long it had.
  setSystemTime(START + 30_000)
  tab.log.unresponsive()
  setSystemTime(START + 31_000)
  tab.log.end({ cause: "renderer-gone", reason: "killed", exitCode: 1 })
  expect(tab.lines[4]?.data).toMatchObject({ cause: "renderer-gone", unresponsiveMs: 1_000 })
})

test("a main-frame load that fails is logged once per navigation, by its code, error name and origin", () => {
  const tab = page()
  tab.log.loadFailed(-102, "ERR_CONNECTION_REFUSED", "http://localhost:3000/admin?token=s3cret")
  tab.log.loadFailed(-102, "ERR_CONNECTION_REFUSED", "http://localhost:3000/admin?token=s3cret")
  tab.log.navigationStarted()
  // A description that is not Chromium's error name is the site's or the product's text.
  tab.log.loadFailed(-501, "The page at https://mail.example.com/inbox?token=s3cret said no", "workspace:alex/payroll.html")

  expect(tab.lines.map((line) => [line.level, line.message])).toEqual([
    ["warn", "browser page load failed"],
    ["warn", "browser page load failed"],
  ])
  expect(tab.lines[0]?.data).toMatchObject({ tab: "tab_1", code: -102, error: "ERR_CONNECTION_REFUSED", origin: "http://localhost:3000" })
  expect(tab.lines[1]?.data).toMatchObject({ tab: "tab_1", code: -501, error: undefined, origin: "preview" })
  expect(JSON.stringify(tab.lines)).not.toMatch(/alex|s3cret|pa55word|inbox|admin/)
})
