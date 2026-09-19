import { expect, test } from "@playwright/test"
import * as http from "node:http"
import type { AddressInfo } from "node:net"
import { createRemoteGateway } from "../../../desktop/src/main/remote-gateway"
import { markup as remoteMobileMarkup } from "../../../opencode/src/remote/mobile"

const SESSION_ID = "ses_remote_e2e"
const TICKET = "ticket-remote-e2e"
const TOKEN = "grant-remote-e2e"

type RemoteMessage = {
  info: { role: "user" | "assistant" }
  parts: Array<{ type: "text"; text: string }>
}

type RemotePermission = {
  id: string
  permission: string
  patterns: string[]
}

type RemoteQuestion = {
  id: string
  questions: Array<{
    question: string
    header: string
    multiple: boolean
    custom: boolean
    options: Array<{ label: string; description?: string }>
  }>
}

type RemoteFixtureState = {
  ticketRedeemed: boolean
  messages: RemoteMessage[]
  status: "idle" | "busy"
  permissions: RemotePermission[]
  questions: RemoteQuestion[]
  prompt?: string
  aborted: boolean
  permissionReply?: string
  questionAnswers?: string[][]
}

test.use({
  viewport: { width: 390, height: 844 },
  video: "on",
})

test.describe("smoke: mobile remote control", () => {
  test("pairs and controls a desktop session through the LAN gateway", async ({ page, request }, testInfo) => {
    const upstream = await startRemoteUpstream()
    const gateway = createRemoteGateway({ upstreamUrl: upstream.origin })

    try {
      const info = await gateway.start()
      const gatewayOrigin = `http://127.0.0.1:${info.port}`

      const blocked = await request.get(`${gatewayOrigin}/session/${SESSION_ID}`)
      expect(blocked.status()).toBe(404)

      await page.goto(`${gatewayOrigin}/remote/mobile#ticket=${TICKET}`)

      await expect(page).toHaveURL(`${gatewayOrigin}/remote/mobile`)
      await expect(page.getByText("Remote E2E Session", { exact: true })).toBeVisible()
      await expect(page.getByText("Desktop session is ready.", { exact: true })).toBeVisible()
      await expect(page.getByText("idle · live", { exact: true })).toBeVisible()
      await expect(page.getByRole("heading", { name: "Permission: bash" })).toBeVisible()
      await expect(page.getByRole("heading", { name: "OpenCode needs your answer" })).toBeVisible()

      await testInfo.attach("remote-mobile-paired", {
        body: await page.screenshot({ fullPage: true }),
        contentType: "image/png",
      })

      await page.getByRole("button", { name: "Allow once" }).click()
      await expect.poll(() => upstream.state.permissionReply).toBe("once")
      await expect(page.getByRole("heading", { name: "Permission: bash" })).toBeHidden()

      const question = page.getByRole("group", { name: "Continue?" })
      await question.getByRole("radio", { name: /Yes/ }).check()
      await page.getByRole("button", { name: "Submit" }).click()
      await expect.poll(() => upstream.state.questionAnswers).toEqual([["Yes"]])
      await expect(page.getByRole("heading", { name: "OpenCode needs your answer" })).toBeHidden()

      const prompt = page.getByPlaceholder("Send an instruction to OpenCode…")
      await prompt.fill("Summarize the latest changes")
      await page.getByRole("button", { name: "Send" }).click()

      await expect.poll(() => upstream.state.prompt).toBe("Summarize the latest changes")
      await expect(prompt).toHaveValue("")
      await expect(page.getByText("Summarize the latest changes", { exact: true })).toBeVisible()
      await expect(page.getByText("Acknowledged from desktop.", { exact: true })).toBeVisible()
      await expect(page.getByText("busy · live", { exact: true })).toBeVisible()

      await testInfo.attach("remote-mobile-active", {
        body: await page.screenshot({ fullPage: true }),
        contentType: "image/png",
      })

      await page.getByRole("button", { name: "Stop" }).click()
      await expect.poll(() => upstream.state.aborted).toBe(true)
      await expect(page.getByText("idle · live", { exact: true })).toBeVisible()
    } finally {
      await gateway.stop()
      await upstream.close()
    }
  })
})

async function startRemoteUpstream() {
  const streams = new Set<http.ServerResponse>()
  const state: RemoteFixtureState = {
    ticketRedeemed: false,
    messages: [
      {
        info: { role: "assistant" },
        parts: [{ type: "text", text: "Desktop session is ready." }],
      },
    ],
    status: "idle",
    permissions: [{ id: "per_remote_e2e", permission: "bash", patterns: ["git status"] }],
    questions: [
      {
        id: "que_remote_e2e",
        questions: [
          {
            question: "Continue?",
            header: "Continue?",
            multiple: false,
            custom: false,
            options: [
              { label: "Yes", description: "Proceed with the task" },
              { label: "No" },
            ],
          },
        ],
      },
    ],
    aborted: false,
  }

  const emit = (type: string) => {
    const data = `event: message\ndata: ${JSON.stringify({ id: `evt_${type}`, type, properties: { sessionID: SESSION_ID } })}\n\n`
    for (const stream of streams) {
      if (stream.destroyed || stream.writableEnded) continue
      stream.write(data)
    }
  }

  const server = http.createServer((request, response) => {
    void handleRemoteRequest({ request, response, state, streams, emit }).catch((error) => {
      if (!response.headersSent) response.writeHead(500, { "content-type": "text/plain; charset=utf-8" })
      response.end(error instanceof Error ? error.message : String(error))
    })
  })

  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error) => {
      server.off("listening", onListening)
      reject(error)
    }
    const onListening = () => {
      server.off("error", onError)
      resolve()
    }
    server.once("error", onError)
    server.once("listening", onListening)
    server.listen(0, "127.0.0.1")
  })

  const address = server.address() as AddressInfo
  return {
    origin: `http://127.0.0.1:${address.port}`,
    state,
    close: async () => {
      for (const stream of streams) stream.end()
      streams.clear()
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()))
        server.closeIdleConnections()
        server.closeAllConnections()
      })
    },
  }
}

async function handleRemoteRequest(input: {
  request: http.IncomingMessage
  response: http.ServerResponse
  state: RemoteFixtureState
  streams: Set<http.ServerResponse>
  emit: (type: string) => void
}) {
  const { request, response, state, streams, emit } = input
  const method = request.method ?? "GET"
  const url = new URL(request.url ?? "/", "http://remote.test")

  if (method === "GET" && url.pathname === "/remote/mobile") {
    response.writeHead(200, {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "content-security-policy":
        "default-src 'none'; connect-src 'self'; img-src 'self' data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
      "permissions-policy": "camera=(), microphone=(), geolocation=()",
      "referrer-policy": "no-referrer",
      "x-content-type-options": "nosniff",
    })
    response.end(remoteMobileMarkup())
    return
  }

  if (method === "POST" && url.pathname === "/remote/pair") {
    const payload = await readJson(request)
    if (state.ticketRedeemed || payload.ticket !== TICKET) {
      response.writeHead(403).end()
      return
    }
    state.ticketRedeemed = true
    return json(response, { token: TOKEN, sessionID: SESSION_ID, expires_in: 3600 })
  }

  if (url.pathname.startsWith(`/remote/session/${SESSION_ID}`)) {
    if (request.headers.authorization !== `Bearer ${TOKEN}`) {
      response.writeHead(403).end()
      return
    }
  }

  const sessionRoot = `/remote/session/${SESSION_ID}`
  if (method === "GET" && url.pathname === sessionRoot) {
    return json(response, {
      session: { title: "Remote E2E Session" },
      messages: state.messages,
      status: { type: state.status },
      permissions: state.permissions,
      questions: state.questions,
    })
  }

  if (method === "GET" && url.pathname === `${sessionRoot}/events`) {
    response.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache, no-transform",
      "x-accel-buffering": "no",
    })
    streams.add(response)
    response.write(
      `event: message\ndata: ${JSON.stringify({ id: "evt_connected", type: "server.connected", properties: { sessionID: SESSION_ID } })}\n\n`,
    )
    request.once("close", () => streams.delete(response))
    return
  }

  if (method === "POST" && url.pathname === `${sessionRoot}/permission/per_remote_e2e`) {
    const payload = await readJson(request)
    state.permissionReply = typeof payload.reply === "string" ? payload.reply : undefined
    state.permissions = []
    json(response, true)
    emit("permission.replied")
    return
  }

  if (method === "POST" && url.pathname === `${sessionRoot}/question/que_remote_e2e`) {
    const payload = await readJson(request)
    state.questionAnswers = Array.isArray(payload.answers) ? (payload.answers as string[][]) : undefined
    state.questions = []
    json(response, true)
    emit("question.replied")
    return
  }

  if (method === "POST" && url.pathname === `${sessionRoot}/message`) {
    const payload = await readJson(request)
    const parts = Array.isArray(payload.parts) ? payload.parts : []
    const first = parts[0] as { type?: unknown; text?: unknown } | undefined
    const text = first?.type === "text" && typeof first.text === "string" ? first.text : ""
    state.prompt = text
    state.status = "busy"
    state.messages.push(
      { info: { role: "user" }, parts: [{ type: "text", text }] },
      { info: { role: "assistant" }, parts: [{ type: "text", text: "Acknowledged from desktop." }] },
    )
    response.writeHead(204).end()
    emit("message.updated")
    return
  }

  if (method === "POST" && url.pathname === `${sessionRoot}/abort`) {
    state.aborted = true
    state.status = "idle"
    json(response, true)
    emit("session.status")
    return
  }

  response.writeHead(404).end()
}

async function readJson(request: http.IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []
  for await (const chunk of request) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  if (chunks.length === 0) return {}
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>
}

function json(response: http.ServerResponse, value: unknown) {
  response.writeHead(200, { "content-type": "application/json; charset=utf-8" })
  response.end(JSON.stringify(value))
}
