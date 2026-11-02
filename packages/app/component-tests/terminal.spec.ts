import type { Locator, Page, WebSocketRoute } from "@playwright/test"
import { expect, sourceURL, story } from "../../stories/playwright/story"

const fixture = sourceURL(new URL("../../gui-plugins/src/terminal/terminal.fixture.tsx", import.meta.url))

// No page loads anything from this origin; the routes below answer its terminal API and socket.
const SERVER = "http://127.0.0.1:4599"

const SIZE = { cols: 80, rows: 24 }

type Frame = { type: number; data: string }

/**
 * A server with one terminal that already wrote `output`: it answers the snapshot and connect ticket, then speaks the
 * persistent PTY socket protocol at `inputProtocol`. A missing `output` is a terminal the server no longer has.
 */
async function serveTerminal(page: Page, input: { ptyID: string; output?: string; inputProtocol?: 0 | 1 }) {
  const frames: Frame[] = []
  const sockets: WebSocketRoute[] = []
  const tail = Buffer.byteLength(input.output ?? "")

  const info = {
    id: input.ptyID,
    title: "Terminal 1",
    userTitle: null,
    command: "bash",
    args: [],
    cwd: "C:/OpenCode/Terminal",
    status: "running",
    pid: 1,
    sessionID: "ses_terminal",
    foregroundProcess: null,
    size: SIZE,
    output: { head: 0, tail },
  }

  await page.route(`${SERVER}/api/experimental/persistent-pty/**`, (route) => {
    const headers = { "access-control-allow-origin": "*", "access-control-allow-headers": "*" }

    if (route.request().method() === "OPTIONS") return route.fulfill({ status: 204, headers })

    if (input.output === undefined) {
      return route.fulfill({
        status: 404,
        headers,
        // SAFETY: the server's wire body for a terminal it does not have.
        // oxlint-disable-next-line anti-slop-effect/no-manual-tagged-construction -- see SAFETY above
        json: { _tag: "PtyNotFoundError", ptyID: input.ptyID, message: `PTY session not found: ${input.ptyID}` },
      })
    }

    if (route.request().url().endsWith("/snapshot")) {
      const checkpoint = Buffer.from(input.output).toString("base64")

      return route.fulfill({
        headers,
        json: { data: { info, text: input.output, checkpoint, cursor: { x: 0, y: 0 } } },
      })
    }

    return route.fulfill({ headers, json: { data: { ticket: "component-ticket", expires_in: 60 } } })
  })

  // The socket mock patches the page's WebSocket when it loads, so this runs before the story mounts.
  await page.routeWebSocket(new RegExp(`/api/experimental/persistent-pty/${input.ptyID}/connect`), (ws) => {
    const url = new URL(ws.url())
    const attachmentID = url.searchParams.get("attachment_id") ?? ""
    sockets.push(ws)
    ws.onMessage((message) => {
      const data = Buffer.from(message)

      frames.push({ type: data[0] ?? -1, data: data.subarray(5).toString() })
    })
    ws.send(
      JSON.stringify({
        type: "attached",
        attachmentID,
        inputProtocol: input.inputProtocol ?? 1,
        info,
        role: "controller",
        generation: 1,
        replay: { requestedOffset: tail, availableOffset: 0, endOffset: tail, truncated: false },
      }),
    )
    ws.send(JSON.stringify({ type: "replay_complete", endOffset: tail }))
  })

  return { frames, sockets }
}

async function mountTerminal(page: Page, mount: (id: string) => Promise<Locator>, ptyID: string) {
  // Any story loads the app styles; the fixture mounts the pane beside it.
  await mount("ui-line-comment--editor")
  await page.evaluate(
    async (input) => {
      const { mountTerminal } = await import(input.fixture)
      mountTerminal({ url: input.server, ptyID: input.ptyID })
    },
    { fixture, server: SERVER, ptyID },
  )

  return page.getByTestId("terminal-fixture")
}

story("does not send the emulator's own answers to terminal queries as input", async ({ page, mount }) => {
  // Device status and attribute queries, in the restored screen and in live output. The daemon answers them.
  const server = await serveTerminal(page, { ptyID: "pty_queries", output: "restored\x1b[6n\x1b[c\r\n" })
  const root = await mountTerminal(page, mount, "pty_queries")

  await expect.poll(() => server.sockets.length).toBe(1)
  await expect.poll(() => server.frames.some((frame) => frame.type === 0)).toBe(true)
  server.sockets[0]!.send(Buffer.from("live\x1b[6n\x1b[5n\x1b[c\r\n"))

  // Typed input lands after the output was written, so any answer would already have been sent.
  await expect(root.locator("textarea")).toBeFocused()
  await page.keyboard.type("x")
  await expect.poll(() => server.frames.filter((frame) => frame.type === 1).length).toBeGreaterThan(0)
  expect(server.frames.filter((frame) => frame.type === 1).map((frame) => frame.data)).toEqual(["x"])
})

story("tells the user a server that predates the input protocol is too old", async ({ page, mount }) => {
  await serveTerminal(page, { ptyID: "pty_old", output: "old server\r\n", inputProtocol: 0 })
  const root = await mountTerminal(page, mount, "pty_old")

  await expect(
    root.getByText("This server is too old for terminals; update OpenCode on it", { exact: true }),
  ).toBeVisible()
  await expect(root.locator("[data-failures]")).toHaveAttribute("data-failures", "1")
})

story("says the connection failed when the terminal cannot be restored", async ({ page, mount }) => {
  const server = await serveTerminal(page, { ptyID: "pty_missing" })
  const root = await mountTerminal(page, mount, "pty_missing")

  await expect(root.getByText("Terminal connection failed", { exact: true })).toBeVisible()
  await expect(root.locator("[data-failures]")).toHaveAttribute("data-failures", "1")
  expect(server.sockets).toEqual([])
})
