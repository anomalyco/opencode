import { spawn } from "node:child_process"
import { mkdir, mkdtemp, copyFile, rm, access, readFile, writeFile } from "node:fs/promises"
import { createServer as createNetServer } from "node:net"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { createRequire } from "node:module"
import { randomUUID } from "node:crypto"

type Case = { id: string; status: "pass"; detail: string }
const required = ["Y01", "Y02", "Y03", "Y04"]
const scriptDir = dirname(fileURLToPath(import.meta.url))
const root = resolve(scriptDir, "../..")
const desktopMain = resolve(root, "src/main")
const outMain = resolve(root, "out/main")
const artifact = join(process.env.APP_DOCK_ARTIFACT_ROOT ?? root, "artifacts/app-dock-youtube/s1.json")
const cases: Case[] = []

const check = (condition: unknown, message: string) => {
  if (!condition) throw new Error(message)
}
const pass = (id: string, detail: string) => cases.push({ id, status: "pass", detail })

const skipReason = (): string | null => {
  if (process.env.APP_DOCK_YOUTUBE !== "1") return "APP_DOCK_YOUTUBE != 1 (opt-in LLM test)"
  if (!process.env.OPENCODE_AUTH_CONTENT) return "OPENCODE_AUTH_CONTENT missing (provider auth)"
  if (!process.env.APP_DOCK_YOUTUBE_MODEL) return "APP_DOCK_YOUTUBE_MODEL missing (provider/model)"
  return null
}

async function freePort() {
  const server = createNetServer()
  await new Promise<void>((ready) => server.listen(0, "127.0.0.1", () => ready()))
  const address = server.address()
  if (!address || typeof address === "string") throw new Error("fixture did not bind")
  const port = address.port
  await new Promise<void>((done) => server.close(() => done()))
  return port
}

const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object"

const collect = (value: unknown, predicate: (node: Record<string, unknown>) => boolean, out: Record<string, unknown>[] = []) => {
  if (Array.isArray(value)) {
    for (const item of value) collect(item, predicate, out)
    return out
  }
  if (isRecord(value)) {
    if (predicate(value)) out.push(value)
    for (const key of Object.keys(value)) collect(value[key], predicate, out)
  }
  return out
}

async function child() {
  const electron = await import("electron")
  const { app, BrowserWindow } = electron
  const { createAppDock } = await import("./app-dock")
  const { handleDockRPC, registerAppDockBridge, registerAppDockWindow } = await import("./app-dock-rpc")
  const { spawnLocalServer } = await import("./server")
  if (!process.versions.electron) throw new Error("Electron child not started")
  app.commandLine.appendSwitch("ignore-certificate-errors")
  await app.whenReady()
  const port = await freePort()
  const password = randomUUID()
  const userDataPath = await mkdtemp(join(tmpdir(), "app-dock-youtube-userdata-"))
  const rawModel = process.env.APP_DOCK_YOUTUBE_MODEL
  check(typeof rawModel === "string", "APP_DOCK_YOUTUBE_MODEL must be provider/model")
  const slash = rawModel.indexOf("/")
  check(slash > 0, "APP_DOCK_YOUTUBE_MODEL must be provider/model")
  const providerID = rawModel.slice(0, slash)
  const modelID = rawModel.slice(slash + 1)
  check(providerID.length > 0 && modelID.length > 0, "APP_DOCK_YOUTUBE_MODEL must be provider/model")
  Object.assign(process.env, {
    OPENCODE_CLIENT: "desktop",
    XDG_STATE_HOME: userDataPath,
    OPENCODE_EXPERIMENTAL_ICON_DISCOVERY: "true",
    OPENCODE_EXPERIMENTAL_FILEWATCHER: "true",
    OPENCODE_PERMISSION: "allow",
  })
  const doc = createAppDock({ developmentMode: () => false })
  registerAppDockBridge(doc)
  const win = new BrowserWindow({ width: 900, height: 700, show: true })
  win.show()
  registerAppDockWindow(win)
  const sidecarPath = process.env.APP_DOCK_SIDECAR
  check(sidecarPath, "APP_DOCK_SIDECAR not propagated to child")
  const server = await spawnLocalServer("127.0.0.1", port, password, {
    userDataPath,
    sidecarPath,
    onStderr: (message) => console.error(`SIDECAR: ${message}`),
    onStdout: (message) => console.error(`SIDECAR-OUT: ${message}`),
    onMessage: handleDockRPC,
  })
  let outcome = 1
  try {
    await server.health.wait
    const url = `http://127.0.0.1:${port}`
    const auth = Buffer.from(`opencode:${password}`).toString("base64")
    const headers = { authorization: `Basic ${auth}`, "content-type": "application/json" }
    const query = `directory=${encodeURIComponent(userDataPath)}`

    const createResponse = await fetch(`${url}/session?${query}`, {
      method: "POST",
      headers,
      body: JSON.stringify({}),
      signal: AbortSignal.timeout(30_000),
    })
    check(createResponse.ok, `session create failed with ${createResponse.status}`)
    const session: unknown = await createResponse.json()
    check(!!session && typeof session === "object" && "id" in session, "session create returned no id")
    const sessionID = session.id
    check(typeof sessionID === "string" && sessionID.length > 0, "session create returned no id")
    pass("Y01", "real sidecar created a live session")

    const promptText =
      "Your first action MUST be a dock_open tool call. Never answer from memory. Use only the dock_open, dock_read and dock_click tools. Open https://www.youtube.com/results?search_query=opencode, read the page, click the first video result, then reply with that video's title. Do nothing else."
    const toolListResponse = await fetch(
      `${url}/experimental/tool?provider=${encodeURIComponent(providerID)}&model=${encodeURIComponent(modelID)}&${query}`,
      { headers, signal: AbortSignal.timeout(30_000) },
    )
    check(toolListResponse.ok, `session tool list failed with ${toolListResponse.status}`)
    const toolList: unknown = await toolListResponse.json()
    check(
      Array.isArray(toolList) &&
        toolList.some((tool) => !!tool && typeof tool === "object" && "id" in tool && tool.id === "dock_open"),
      "dock_open missing from session tool list for live model",
    )
    pass("Y02", "dock_* tools visible in session tool list for live model")

    const promptResponse = await fetch(`${url}/session/${sessionID}/message?${query}`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: { providerID, modelID },
        ...(process.env.APP_DOCK_YOUTUBE_VARIANT ? { variant: process.env.APP_DOCK_YOUTUBE_VARIANT } : {}),
        system:
          "You control a live browser through tools. You have no browsing knowledge after training. " +
          "For ANY question about live web content you MUST call tools and read results before answering. " +
          "Answering from memory is forbidden and will be scored as failure.",
        parts: [{ type: "text", text: promptText }],
      }),
      signal: AbortSignal.timeout(300_000),
    })
    if (!promptResponse.ok) {
      const messagesResponse = await fetch(`${url}/session/${sessionID}/message?${query}`, {
        headers,
        signal: AbortSignal.timeout(30_000),
      })
      const messagesBody = await messagesResponse.text()
      throw new Error(
        `session prompt failed with ${promptResponse.status}: ${(await promptResponse.text()).slice(0, 300)} | messages: ${messagesBody.slice(0, 800)}`,
      )
    }
    const turn = await promptResponse.json()

    console.error(`TURN-HEAD: ${JSON.stringify(turn).slice(0, 1500)}`)
    const turnErrors = collect(turn, (node) => !!node.error).map((node) => JSON.stringify(node.error).slice(0, 300))
    const toolCalls = collect(turn, (node) => node.type === "tool" && typeof node.tool === "string" && node.tool.startsWith("dock_"))
    const allTools = collect(turn, (node) => node.type === "tool" && typeof node.tool === "string").map((node) => String(node.tool))
    const modelTexts = collect(turn, (node) => node.type === "text" && typeof node.text === "string")
    const lastNode = modelTexts.length > 0 ? modelTexts[modelTexts.length - 1] : undefined
    const lastText = !!lastNode && typeof lastNode.text === "string" ? lastNode.text : ""
    check(
      toolCalls.length > 0,
      `live model turn invoked no dock_* tools (tools used: ${JSON.stringify(allTools.slice(0, 10))}; text: ${JSON.stringify(lastText.slice(0, 200))}; errors: ${JSON.stringify(turnErrors.slice(0, 2))})`,
    )
    pass("Y03", "live model invoked dock_* tools against YouTube")

    const texts = collect(turn, (node) => node.type === "text" && typeof node.text === "string" && node.text.trim().length > 10)
    check(texts.length > 0, "live model turn produced no final text")
    pass("Y04", "live model reported back with text")

    outcome = cases.length === required.length && required.every((id) => cases.some((item: Case) => item.id === id)) ? 0 : 1
  } finally {
    const report = { version: 1, cases }
    await mkdir(dirname(artifact), { recursive: true })
    await writeFile(artifact, JSON.stringify(report, null, 2))
    await server.listener.stop()
    win.destroy()
    app.exit(outcome)
  }
}

async function parent() {
  const skipped = skipReason()
  if (skipped) {
    await mkdir(dirname(artifact), { recursive: true })
    await writeFile(artifact, JSON.stringify({ version: 1, skipped: true, reason: skipped, cases: [] }, null, 2))
    console.log(`app-dock-youtube skipped: ${skipped}`)
    return
  }
  const buildDir = await mkdtemp(join(tmpdir(), "app-dock-youtube-e2e-"))
  try {
    const result = await Bun.build({
      entrypoints: [join(desktopMain, "app-dock-youtube.test.ts")],
      outdir: buildDir,
      naming: "app-dock-youtube.test.cjs",
      target: "node",
      format: "cjs",
      external: ["electron"],
      write: true,
    })
    check(result.success && result.outputs?.[0], "bundle failed")
    const built = result.outputs![0].path
    await access(built)
    const sidecar = join(outMain, "sidecar.js")
    await access(sidecar)
    const hosted = join(outMain, "app-dock-youtube.test.cjs")
    await copyFile(built, hosted)
    const electronModule = createRequire(join(process.cwd(), "package.json")).resolve("electron")
    const electron = join(dirname(electronModule), "dist/Electron.app/Contents/MacOS/Electron")
    await access(electron)
    const env = {
      ...process.env,
      APP_DOCK_ARTIFACT_ROOT: root,
      APP_DOCK_SIDECAR: sidecar,
      ELECTRON_DISABLE_SECURITY_WARNINGS: "true",
    }
    await rm(artifact, { force: true })
    const child = spawn(electron, [hosted, "--app-dock-youtube-child"], { stdio: ["ignore", "pipe", "pipe"], env })
    let stderr = ""
    child.stderr.on("data", (chunk) => { stderr += chunk })
    let timedOut = false
    const watchdog = setTimeout(() => {
      timedOut = true
      child.kill("SIGKILL")
    }, 600_000)
    const exitResult = await new Promise<{ code: number | null }>((resolveProcess, reject) => {
      child.once("exit", (code) => resolveProcess({ code }))
      child.once("error", reject)
    })
    clearTimeout(watchdog)
    if (exitResult.code !== 0) throw new Error(`child failed (${exitResult.code})${timedOut ? " timed out" : ""}: ${stderr}`)
    const report = JSON.parse(await readFile(artifact, "utf8"))
    if (report.skipped === true) {
      console.log(`app-dock-youtube skipped: ${report.reason}`)
      return
    }
    check(
      report.version === 1 &&
        Array.isArray(report.cases) &&
        report.cases.length === required.length &&
        required.every((id) => report.cases.some((item: Case) => item.id === id && item.status === "pass")),
      "invalid app-dock-youtube artifact",
    )
  } finally {
    await rm(buildDir, { recursive: true, force: true })
    await rm(join(outMain, "app-dock-youtube.test.cjs"), { force: true })
  }
}

if (process.argv.includes("--app-dock-youtube-child"))
  void child().catch((error) => {
    console.error(error)
    process.exit(1)
  })
else
  void parent().catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
