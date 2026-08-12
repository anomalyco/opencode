import { mkdir } from "node:fs/promises"
import { resolve } from "node:path"

const serviceMode = process.env.OPENCODE_DRIVE_SCRIPTED === "1"
const role = serviceMode
  ? process.argv.includes("serve") && process.argv.includes("--service")
    ? "service"
    : "client"
  : "legacy"
if (process.argv.includes("stdio-markers")) {
  console.log(`fake-${role}-stdout`)
  console.error(`fake-${role}-stderr`)
}
if (role === "service" && process.env.OPENCODE_TEST_HOME)
  await Promise.all([
    Bun.write(`${process.env.OPENCODE_TEST_HOME}/service.pid`, String(process.pid)),
    Bun.write(`${process.env.OPENCODE_TEST_HOME}/service-argv.json`, JSON.stringify(process.argv.slice(2))),
    Bun.write(`${process.env.OPENCODE_TEST_HOME}/service-db.txt`, process.env.OPENCODE_DB ?? "missing"),
  ])

const screen = { value: `Fake OpenCode${role === "client" ? ` ${process.env.OPENCODE_DRIVE}` : ""}` }
const drive = await resolveDrive()
const recordingStarted = performance.now()
const endpoints = drive.endpoints
let toolAttachments = 0
let backendHandshakes = 0
const exitAfterAttach = Promise.withResolvers<void>()
const servicePassword = "drive-test-password"
const api = role === "service"
  ? Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch(request) {
        if (
          request.headers.get("authorization") !==
          `Basic ${btoa(`opencode:${servicePassword}`)}`
        )
          return Response.json({ _tag: "UnauthorizedError", message: "Unauthorized" }, { status: 401 })
        const url = new URL(request.url)
        if (url.pathname === "/api/health")
          return Response.json({ healthy: true, version: "test", pid: process.pid })
        if (url.pathname === "/api/server") {
          const directory = process.env.XDG_STATE_HOME
            ? resolve(process.env.XDG_STATE_HOME, "../../..", "files")
            : undefined
          if (request.headers.get("x-opencode-directory") !== encodeURIComponent(directory ?? ""))
            return Response.json({ _tag: "InvalidRequestError", message: "Wrong directory" }, { status: 400 })
          return Response.json({ urls: [] })
        }
        return Response.json({ _tag: "InvalidRequestError", message: "Not found" }, { status: 404 })
      },
    })
  : undefined
if (
  api !== undefined &&
  process.env.XDG_STATE_HOME &&
  !process.argv.includes("omit-service-registration")
) {
  const directory = `${process.env.XDG_STATE_HOME}/opencode`
  await mkdir(directory, { recursive: true })
  await Bun.write(
    `${directory}/service-testchannel.json`,
    JSON.stringify({
      id: crypto.randomUUID(),
      version: "test",
      url: `http://127.0.0.1:${api.port}`,
      pid: process.pid,
      password: servicePassword,
    }),
  )
}
if (drive.recording && role !== "service")
  await Bun.write(
    drive.recording.timeline,
    `${JSON.stringify({ type: "header", version: 1, cols: 100, rows: 40, encoding: "base64" })}\n${JSON.stringify({ type: "output", at_ms: 0, data: Buffer.from("Fake OpenCode").toString("base64") })}\n`,
  )
if (process.env.OPENCODE_TEST_HOME && role !== "service") {
  await Bun.write(
    `${process.env.OPENCODE_TEST_HOME}/child.pid`,
    String(process.pid),
  )
  const launches = `${process.env.OPENCODE_TEST_HOME}/launches.txt`
  await appendFile(launches, "launch\n")
  await Bun.write(
    `${process.env.OPENCODE_TEST_HOME}/renderer.txt`,
    process.env.OPENCODE_DRIVE_RENDERER ?? "missing",
  )
  await Bun.write(
    `${process.env.OPENCODE_TEST_HOME}/child-cwd.txt`,
    process.cwd(),
  )
  const seeded = `${process.cwd()}/src/seeded.ts`
  if (await Bun.file(seeded).exists())
    await Bun.write(
      `${process.env.OPENCODE_TEST_HOME}/seeded-at-launch.txt`,
      await Bun.file(seeded).text(),
    )
}

const ui = role === "service" || process.argv.includes("no-ui") ? undefined : Bun.serve({
  hostname: "127.0.0.1",
  port: Number(new URL(endpoints.ui).port),
  fetch(request, server) {
    if (server.upgrade(request)) return
    return new Response("drive websocket", { status: 426 })
  },
  websocket: {
    message(socket, input) {
      const request = JSON.parse(String(input)) as {
        readonly id?: number
        readonly method: string
        readonly params?: unknown
      }
      const result = frontend(request.method, request.params)
      if (request.id !== undefined)
        socket.send(JSON.stringify({ jsonrpc: "2.0", id: request.id, result }))
    },
  },
})

const backend = role === "client" ? undefined : Bun.serve({
  hostname: "127.0.0.1",
  port: Number(new URL(endpoints.backend).port),
  fetch(request, server) {
    if (server.upgrade(request)) return
    return new Response("drive websocket", { status: 426 })
  },
  websocket: {
    async message(socket, input) {
      const request = JSON.parse(String(input)) as {
        readonly id?: number
        readonly method: string
        readonly params?: unknown
      }
      if (
        request.method === "simulation.handshake" &&
        process.argv.includes("reject-tool-handshake") &&
        ++backendHandshakes === 2
      ) {
        if (request.id !== undefined)
          socket.send(
            JSON.stringify({
              jsonrpc: "2.0",
              id: request.id,
              error: { code: -32000, message: "tool handshake rejected" },
            }),
          )
        return
      }
      if (request.method === "llm.chunk" && process.env.OPENCODE_TEST_HOME) {
        await Bun.write(
          `${process.env.OPENCODE_TEST_HOME}/mock-response.json`,
          JSON.stringify(request.params),
        )
      }
      if (request.method.startsWith("llm.") && process.env.OPENCODE_TEST_HOME) {
        const events = `${process.env.OPENCODE_TEST_HOME}/backend-events.jsonl`
        await appendFile(
          events,
          `${JSON.stringify({ method: request.method, params: request.params })}\n`,
        )
      }
      if (request.method.startsWith("tool.") && process.env.OPENCODE_TEST_HOME) {
        const events = `${process.env.OPENCODE_TEST_HOME}/tool-events.jsonl`
        await appendFile(
          events,
          `${JSON.stringify({ method: request.method, params: request.params })}\n`,
        )
      }
      if (
        request.method === "tool.attach" &&
        process.argv.includes("dynamic-tool")
      )
        if (
          (++toolAttachments === 1 &&
            !process.argv.includes("reconnect-tool")) ||
          toolAttachments === 2
        )
          socket.send(
            JSON.stringify({
              jsonrpc: "2.0",
              method: "tool.invocation",
              params: {
                id: "tool_1",
                name: "lookup",
                input: { query: "meaning" },
                context: {
                  sessionID: "ses_dynamic",
                  agent: "build",
                  messageID: "msg_dynamic",
                  id: "call_lookup",
                },
              },
            }),
          )
      if (
        request.method === "tool.attach" &&
        process.argv.includes("reject-tool-reconnect") &&
        toolAttachments === 2
      ) {
        if (request.id !== undefined)
          socket.send(
            JSON.stringify({
              jsonrpc: "2.0",
              id: request.id,
              error: { code: -32000, message: "tool reconnect rejected" },
            }),
          )
        return
      }
      const result =
        request.method === "simulation.handshake"
          ? handshake(request.params, "backend")
          : request.method === "llm.attach" || request.method === "tool.attach"
            ? { attached: true }
            : { ok: true }
      if (request.id !== undefined)
        socket.send(JSON.stringify({ jsonrpc: "2.0", id: request.id, result }))
      if (
        request.method === "tool.attach" &&
        process.argv.includes("reconnect-tool") &&
        toolAttachments === 1
      )
        setTimeout(() => socket.close(), 10)
      if (request.method === "llm.attach") {
        const requestDelay = Number(process.argv[3])
        if (Number.isFinite(requestDelay)) await Bun.sleep(requestDelay)
        if (process.argv.includes("title-requests"))
          socket.send(
            JSON.stringify({
              jsonrpc: "2.0",
              method: "llm.request",
              params: {
                id: "ex_title",
                url: "https://api.openai.com/v1/chat/completions",
                body: {
                  messages: [
                    {
                      role: "system",
                      content: "You are a title generator. You output ONLY a thread title.",
                    },
                  ],
                },
              },
            }),
          )
        if (process.argv.includes("latest-title-requests"))
          socket.send(
            JSON.stringify({
              jsonrpc: "2.0",
              method: "llm.request",
              params: {
                id: "ex_title",
                url: "https://api.openai.com/v1/chat/completions",
                body: {
                  messages: [
                    {
                      role: "user",
                      content: "Generate a title for this conversation:\n",
                    },
                    {
                      role: "user",
                      content: "Show a compact status report for the viewport resize demo.",
                    },
                  ],
                },
              },
            }),
          )
        socket.send(
          JSON.stringify({
            jsonrpc: "2.0",
            method: "llm.request",
            params: {
              id: "ex_mock",
              url: "https://api.openai.com/v1/chat/completions",
              body: {},
            },
          }),
        )
        if (process.argv.includes("exit-after-attach")) exitAfterAttach.resolve()
      }
    },
  },
})

if (process.argv.includes("write-stdio")) {
  console.log(`fake opencode ${role} stdout`)
  console.error(`fake opencode ${role} stderr`)
}

await new Promise<void>((resolve) => {
  process.once("SIGINT", resolve)
  if (process.argv.includes("ignore-sigterm"))
    process.on("SIGTERM", () => undefined)
  else process.once("SIGTERM", resolve)
  const lifetime = role === "service" ? Number.NaN : Number(process.argv[2])
  if (Number.isFinite(lifetime)) setTimeout(resolve, lifetime)
  if (process.argv.includes("exit-after-attach")) void exitAfterAttach.promise.then(resolve)
})
await Promise.all([ui?.stop(true), backend?.stop(true)])

function frontend(method: string, params: unknown) {
  if (method === "simulation.handshake") return handshake(params, "ui")
  if (method === "ui.capture") {
    return {
      cols: 80,
      rows: 24,
      cursor: [0, 0],
      lines: [{ spans: [{ text: screen.value, fg: [255, 255, 255, 255], bg: [0, 0, 0, 255], attributes: 0, width: screen.value.length }] }],
    }
  }
  if (method === "ui.snapshot") {
    return {
      format: "opencode-ui-snapshot-v1",
      nodes: [
        {
          id: "prompt",
          role: "textbox",
          label: "Prompt",
          element: 1,
          focused: true,
          disabled: false,
        },
      ],
    }
  }
  if (method === "ui.screenshot") {
    const name = isRecord(params) && typeof params.name === "string"
      ? params.name
      : `screenshot-${crypto.randomUUID()}`
    return `${process.env.OPENCODE_DRIVE_MEDIA_DIR}/${name}.png`
  }
  if (method === "ui.recording.finish") {
    if (!drive.recording) throw new Error("recording is not enabled")
    return drive.recording.timeline
  }
  if (method === "ui.resize" && drive.recording && isRecord(params)) {
    void appendFile(
      drive.recording.timeline,
      `${JSON.stringify({
        type: "resize",
        at_ms: Math.max(1, Math.round(performance.now() - recordingStarted)),
        cols: params.cols,
        rows: params.rows,
      })}\n`,
    )
  }
  if (method === "ui.matches" && isRecord(params) && typeof params.text === "string")
    return screen.value.includes(params.text)
  if (
    method === "ui.type" &&
    isRecord(params) &&
    typeof params.text === "string"
  )
    screen.value += `\n${params.text}`
  if (method === "ui.enter") screen.value += "\n[enter]"
  if (method === "trace.list" || method === "trace.export")
    return { records: [] }
  if (method === "trace.clear") return { cleared: true }
  return {
    screen: screen.value,
    focused: { renderable: 1, editor: true },
    elements: [
      {
        id: "prompt",
        num: 1,
        x: 0,
        y: 0,
        width: 80,
        height: 1,
        focusable: true,
        focused: true,
        clickable: true,
        editor: true,
      },
    ],
  }
}

function handshake(params: unknown, role: "ui" | "backend") {
  if (!isRecord(params)) throw new Error("invalid handshake")
  const required = Array.isArray(params.requiredCapabilities)
    ? params.requiredCapabilities.filter((value): value is string =>
        typeof value === "string"
      )
    : []
  const optional = Array.isArray(params.optionalCapabilities)
    ? params.optionalCapabilities.filter((value): value is string =>
        typeof value === "string"
      )
    : []
  return {
    protocolVersion: 1,
    role,
    server: { name: "opencode", version: "test" },
    capabilities: [...required, ...optional],
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

async function resolveDrive() {
  if (process.env.DRIVE_REGISTRY_DIR && process.env.OPENCODE_DRIVE !== "1") {
    const manifest = (await Bun.file(
      `${process.env.DRIVE_REGISTRY_DIR}/${process.env.OPENCODE_DRIVE}.json`,
    ).json()) as {
      readonly endpoints: { readonly ui: string; readonly backend: string }
      readonly recording?: { readonly timeline: string }
    }
    return manifest
  }
  return {
    endpoints: {
      ui: "ws://127.0.0.1:40900",
      backend: "ws://127.0.0.1:40950",
    },
    recording: { timeline: "/tmp/opencode-drive-fake/recording.jsonl" },
  }
}
import { appendFile } from "node:fs/promises"
