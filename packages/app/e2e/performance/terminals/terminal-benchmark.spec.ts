import { createRequire } from "node:module"
import { mkdtemp, writeFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import type { Page } from "@playwright/test"
import { benchmark, benchmarkDiagnostics, expect } from "../benchmark"
import { mockOpenCodeServer } from "../../utils/mock-server"
import { expectSessionTitle } from "../../utils/waits"
import type {} from "./probe"

// Use the same installed native PTY package as Core, with a fixture-owned process.
const native = createRequire(new URL("../../../../core/package.json", import.meta.url))("@lydell/node-pty") as {
  spawn: (
    file: string,
    args: string[],
    options: { cols: number; rows: number; cwd: string },
  ) => {
    pid: number
    write: (data: string) => void
    resize: (cols: number, rows: number) => void
    kill: () => void
    onData: (handler: (data: string) => void) => { dispose: () => void }
    onExit: (handler: () => void) => { dispose: () => void }
  }
}

const sessionID = "ses_terminal_benchmark"
const ptyID = "pty_terminal_benchmark"
const title = "Terminal build output"
const server = process.env.PLAYWRIGHT_BASE_URL!
const href = `/server/${Buffer.from(server).toString("base64url")}/session/${sessionID}`
const lines = Array.from({ length: 12_000 }, (_, i) => {
  const unit = ["session/history", "session/runner", "project/discovery", "tool/shell", "provider/stream"][i % 5]
  return `\x1b[32mPASS\x1b[0m packages/core/test/${unit}-${String(i).padStart(5, "0")}.test.ts \x1b[2m[${10 + (i % 237)}ms]\x1b[0m validates ordered output and durable recovery`
}).join("\r\n")

benchmark.use({ traceScope: "interaction", viewport: { width: 1440, height: 900 } })

for (const scenario of ["visible-output", "hidden-output", "full-scrollback-teardown"] as const) {
  benchmark(scenario, async ({ page, report }, info) => {
    const dir = await mkdtemp(path.join(process.env.TERMINAL_ARTIFACTS ?? tmpdir(), "terminal-fixture-"))
    await writeFile(path.join(dir, "build.log"), lines)
    const pty = native.spawn(
      "pwsh.exe",
      [
        "-NoLogo",
        "-NoProfile",
        "-NonInteractive",
        "-File",
        fileURLToPath(new URL("./shell.ps1", import.meta.url)),
        "-Fixture",
        path.join(dir, "build.log"),
      ],
      { cols: 120, rows: 24, cwd: dir },
    )
    const exited = new Promise<void>((resolve) => pty.onExit(resolve))
    let output = ""
    let connected = 0
    let closed = 0
    let send: ((data: string) => void) | undefined
    const listener = pty.onData((data) => {
      output += data
      send?.(data)
    })
    const sizes: { cols: number; rows: number }[] = []
    const removals: string[] = []
    try {
      if (process.env.TERMINAL_DRAW_PROBE) {
        await page.addInitScript(() => {
          const fill = CanvasRenderingContext2D.prototype.fillText
          CanvasRenderingContext2D.prototype.fillText = function (...args: Parameters<typeof fill>) {
            if (this.canvas instanceof HTMLCanvasElement && this.canvas.closest('[data-component="terminal"]')) {
              window.terminalProbe.draws++
              if (!this.canvas.checkVisibility()) window.terminalProbe.hiddenDraws++
            }
            Reflect.apply(fill, this, args)
          }
        })
      }
      const location = { directory: dir, project: { id: "proj_terminal_benchmark", directory: dir } }
      const data = {
        id: ptyID,
        title: "Terminal 1",
        command: "pwsh.exe",
        args: [],
        cwd: dir,
        status: "running",
        pid: pty.pid,
      }
      await mockOpenCodeServer(page, {
        directory: dir,
        project: {
          id: location.project.id,
          worktree: dir,
          vcs: "git",
          name: "terminal-benchmark",
          time: { created: 1, updated: 1 },
          sandboxes: [],
        },
        provider: {
          all: [
            {
              id: "opencode",
              name: "OpenCode",
              models: { test: { id: "test", name: "Test", limit: { context: 200_000 } } },
            },
          ],
          connected: ["opencode"],
          default: { providerID: "opencode", modelID: "test" },
        },
        sessions: [
          {
            id: sessionID,
            slug: sessionID,
            projectID: location.project.id,
            directory: dir,
            title,
            version: "dev",
            time: { created: 1700000000000, updated: 1700000000000 },
          },
        ],
        pageMessages: () => ({ items: [] }),
      })
      await page.route("**/api/pty**", async (route) => {
        if (route.request().method() === "DELETE") removals.push(route.request().url())
        const body = route.request().postDataJSON()
        if (body?.size) {
          sizes.push(body.size)
          pty.resize(body.size.cols, body.size.rows)
        }
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            location,
            data: route.request().url().includes("connect-token") ? { ticket: "fixture", expires_in: 60 } : data,
          }),
        })
      })
      await page.routeWebSocket(new RegExp(`/api/pty/${ptyID}/connect`), (socket) => {
        connected++
        send = (data) => socket.send(data)
        socket.send(output.slice(Number(new URL(socket.url()).searchParams.get("cursor") ?? 0)))
        socket.onMessage((data) => pty.write(String(data)))
        socket.onClose(() => {
          closed++
          send = undefined
        })
      })
      await page.addInitScript(
        ({ server, sessionID }) => {
          localStorage.setItem("settings.v3", JSON.stringify({ general: { terminalPlacement: "bottom" } }))
          localStorage.setItem(
            "opencode.window.browser.dat:tabs",
            JSON.stringify([{ type: "session", server, sessionId: sessionID }]),
          )
        },
        { server, sessionID },
      )
      await page.goto(
        `${href}${process.env.TERMINAL_DRAW_PROBE && scenario !== "full-scrollback-teardown" ? "?terminalDrawProbe" : ""}`,
      )
      await expectSessionTitle(page, title)
      await page.keyboard.press("Control+Backquote")
      await waitForText(page, "TERMINAL_FIXTURE_READY")
      const terminal = page.locator('[data-component="terminal"]')
      await expect(terminal).toBeVisible()
      await page.evaluate(() => document.fonts.ready.then(() => undefined))
      await expect
        .poll(async () => {
          const size = await page.evaluate(() => ({
            cols: window.terminalProbe.term!.cols,
            rows: window.terminalProbe.term!.rows,
          }))
          return sizes.at(-1)?.cols === size.cols && sizes.at(-1)?.rows === size.rows
        })
        .toBe(true)
      if (scenario === "hidden-output") {
        await page.keyboard.press("Control+Backquote")
        await expect(terminal).toBeHidden()
      }
      const cdp = await page.context().newCDPSession(page)
      await cdp.send("Performance.enable")
      const before = await cdp.send("Performance.getMetrics")
      const start = await page.evaluate(() => {
        window.terminalProbe.renders = 0
        window.terminalProbe.hiddenRenders = 0
        window.terminalProbe.draws = 0
        window.terminalProbe.hiddenDraws = 0
        return performance.now()
      })
      await benchmarkDiagnostics(page).startTrace()
      // The producer is not throttled. The visible and hidden cases receive the same bytes.
      pty.write("run\r")
      await waitForText(page, "TERMINAL_WORKLOAD_DONE")
      const produced = await page.evaluate(
        (start) => ({
          ms: performance.now() - start,
          renders: window.terminalProbe.renders,
          hiddenRenders: window.terminalProbe.hiddenRenders,
          draws: window.terminalProbe.draws,
          hiddenDraws: window.terminalProbe.hiddenDraws,
          bytes: window.terminalProbe.bytes,
          scrollback: window.terminalProbe.term!.getScrollbackLength(),
          cols: window.terminalProbe.term!.cols,
          rows: window.terminalProbe.term!.rows,
          firstRecord: Number(
            window.terminalProbe
              .term!.buffer.normal.getLine(0)
              ?.translateToString(true)
              .match(/-(\d{5})\.test\.ts/)?.[1],
          ),
        }),
        start,
      )
      const after = await cdp.send("Performance.getMetrics")
      const cpuMs =
        (after.metrics.find((x) => x.name === "TaskDuration")!.value -
          before.metrics.find((x) => x.name === "TaskDuration")!.value) *
        1000
      let interaction: Record<string, unknown> = {}
      if (scenario === "hidden-output") {
        const start = await page.evaluate(() => performance.now())
        await page.keyboard.press("Control+Backquote")
        await expect(terminal).toBeVisible()
        await waitForText(page, "TERMINAL_WORKLOAD_DONE")
        interaction = { returnMs: await page.evaluate((start) => performance.now() - start, start) }
      }
      if (scenario === "full-scrollback-teardown") {
        // Ghostty converts the configured line limit to bytes at the initial
        // 80-column size. Resizing changes the effective retained row count.
        expect(produced.scrollback).toBeGreaterThan(0)
        expect(produced.firstRecord).toBeGreaterThan(0)
        expect(produced.firstRecord).toBeLessThan(11_999)
        const close = page.locator(`[data-titlebar-tab-slot]:has(a[href="${href}"]) [data-component="icon-button-v2"]`)
        await expect(close).toBeVisible()
        const cpuBefore = await cdp.send("Performance.getMetrics")
        const start = await page.evaluate(() => performance.now())
        await close.click()
        await expect(page).toHaveURL("/")
        await expect(page.locator('[data-component="home-session-search"]')).toBeVisible()
        await expect(page.locator('[data-component="home-session-search"] input')).toBeEditable()
        await expect.poll(() => page.evaluate(() => window.terminalProbe.serialized.length)).toBe(1)
        interaction = await page.evaluate(
          (start) => ({
            homeReadyMs: performance.now() - start,
            serializeMs: window.terminalProbe.serialized[0].ms,
            serializedBytes: window.terminalProbe.serialized[0].bytes,
          }),
          start,
        )
        const cpuAfter = await cdp.send("Performance.getMetrics")
        interaction.teardownCpuMs =
          (cpuAfter.metrics.find((x) => x.name === "TaskDuration")!.value -
            cpuBefore.metrics.find((x) => x.name === "TaskDuration")!.value) *
          1000
        const snapshot = await page.evaluate(() => window.terminalProbe.serialized[0].value)
        expect(Array.from(snapshot.matchAll(/-(\d{5})\.test\.ts/g), (match) => Number(match[1]))).toEqual(
          Array.from({ length: 12_000 - produced.firstRecord }, (_, index) => produced.firstRecord + index),
        )
        expect(snapshot).toContain("TERMINAL_WORKLOAD_DONE")
        await writeFile(
          path.join(
            process.env.TERMINAL_ARTIFACTS ?? tmpdir(),
            `${process.env.TERMINAL_BUNDLE}-${info.repeatEachIndex}.ansi`,
          ),
          snapshot,
        )
        await expect(terminal).toHaveCount(0)
        expect(closed).toBe(1)
        // UI teardown must not terminate the native process.
        pty.write("ping\r")
        await expect.poll(() => output.includes("TERMINAL_PROCESS_ALIVE")).toBe(true)
      }
      await benchmarkDiagnostics(page).stop()
      expect(connected).toBe(1)
      expect(removals).toEqual([])
      expect(sizes.length).toBeGreaterThan(0)
      report(
        { ...produced, cpuMs, ...interaction },
        {
          revision: process.env.TERMINAL_REVISION,
          bundle: process.env.TERMINAL_BUNDLE,
          fixtureBytes: Buffer.byteLength(lines),
          fixtureLines: 12_000,
          transport: "Windows ConPTY -> Playwright WebSocket fixture -> production Terminal/writer/Ghostty",
          scope: "Chromium renderer; not Electron total RAM or production backend IPC",
        },
      )
      if (scenario !== "full-scrollback-teardown") {
        // Validate input, focus, and resize after both visible and hidden output.
        await terminal.click()
        await expect(terminal.locator("textarea")).toBeFocused()
        await page.keyboard.type("ping")
        await page.keyboard.press("Enter")
        await waitForText(page, "TERMINAL_PROCESS_ALIVE")
        const columns = await page.evaluate(() => window.terminalProbe.term!.cols)
        await page.setViewportSize({ width: 1100, height: 800 })
        await expect.poll(() => page.evaluate(() => window.terminalProbe.term!.cols)).not.toBe(columns)
        await expect
          .poll(async () => sizes.at(-1)?.cols === (await page.evaluate(() => window.terminalProbe.term!.cols)))
          .toBe(true)
        expect(closed).toBe(0)
      }
      if (process.env.TERMINAL_SCREENSHOTS && scenario !== "full-scrollback-teardown") {
        await page.screenshot({
          path: path.join(process.env.TERMINAL_SCREENSHOTS, `${scenario}-${info.repeatEachIndex}.png`),
        })
      }
    } finally {
      listener.dispose()
      try {
        await benchmarkDiagnostics(page).stop()
        // Stop fixture request handlers before killing their native resource. The
        // app debounces PTY resize requests independently of the canvas resize.
        await page.unrouteAll({ behavior: "wait" })
        await page.close()
      } finally {
        pty.kill()
        await exited
        await writeFile(
          path.join(
            process.env.TERMINAL_ARTIFACTS ?? tmpdir(),
            `${process.env.TERMINAL_BUNDLE}-${scenario}-${info.repeatEachIndex}.native.log`,
          ),
          output,
        )
        await rm(dir, { recursive: true, force: true })
      }
    }
  })
}

async function waitForText(page: Page, text: string) {
  await expect
    .poll(() =>
      page.evaluate((text) => {
        const probe = window.terminalProbe
        const term = probe?.term
        if (!term || probe.pending !== 0) return false
        const buffer = term.buffer.active
        return Array.from(
          { length: term.rows },
          (_, i) => buffer.getLine(buffer.length - term.rows + i)?.translateToString(true) ?? "",
        )
          .join("\n")
          .includes(text)
      }, text),
    )
    .toBe(true)
}
