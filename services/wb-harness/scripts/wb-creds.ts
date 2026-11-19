import { execFileSync } from "node:child_process"
import { writeCredentials, describeCredentials, tokenExpiry, type Credentials } from "../src/credentials"

type Browser = {
  app: string
  bundle: string
  profile: string
}

const browsers: Record<string, Browser> = {
  helium: {
    app: "/Applications/Helium.app",
    bundle: "net.imput.helium",
    profile: "~/Library/Application Support/net.imput.helium",
  },
  chrome: {
    app: "/Applications/Google Chrome.app",
    bundle: "com.google.Chrome",
    profile: "~/Library/Application Support/Google/Chrome",
  },
  brave: {
    app: "/Applications/Brave Browser.app",
    bundle: "com.brave.Browser",
    profile: "~/Library/Application Support/BraveSoftware/Brave-Browser",
  },
  edge: {
    app: "/Applications/Microsoft Edge.app",
    bundle: "com.microsoft.edgemac",
    profile: "~/Library/Application Support/Microsoft Edge",
  },
}

const args = process.argv.slice(2)
const browserName = readArg("--browser") ?? "helium"
const port = readArg("--port") ?? "9333"
const cdp = readArg("--cdp") ?? `http://127.0.0.1:${port}`
const browser = browsers[browserName]
const upstream = process.env.WB_UPSTREAM ?? "https://ai-proxy.wildberries.ru/ai-proxy/api/chat/v5/message"

if (!browser) {
  fail(`unknown browser "${browserName}". Choose: ${Object.keys(browsers).join(", ")}`)
}

if (args.includes("--launch")) {
  await launch()
}

const credentials = await extract()
const path = writeCredentials(credentials)

console.log(`saved ${path}`)
console.log(describeCredentials(credentials))

if (args.includes("--env")) {
  console.log(`\nWB_TOKEN=${credentials.token}\nWB_USERDATA=${credentials.userdata}`)
}

if (args.includes("--check")) {
  const status = await check(credentials)
  console.log(`upstream check: ${status}`)
  if (status !== "ok") process.exit(1)
}

if (args.includes("--restore")) {
  await restoreBrowser()
}

function readArg(name: string): string | undefined {
  const index = args.indexOf(name)
  return index === -1 ? undefined : args[index + 1]
}

function fail(message: string): never {
  console.error(message)
  process.exit(1)
}

async function launch() {
  const reachable = await fetchJSON(`${cdp}/json/version`).catch(() => undefined)
  if (reachable) {
    console.log(`${browserName} already exposes ${cdp}`)
    return
  }

  console.log(`restarting ${browserName} with remote debugging on port ${port}`)
  try {
    execFileSync("osascript", ["-e", `tell application id "${browser.bundle}" to quit`])
  } catch {
    // The browser may not be running.
  }
  execFileSync("sleep", ["2"])
  execFileSync("open", [
    "-na",
    browser.app,
    "--args",
    `--remote-debugging-port=${port}`,
    "--restore-last-session",
  ])
  execFileSync("sleep", ["4"])
}

async function restoreBrowser() {
  console.log(`restarting ${browserName} without the debugging port`)
  try {
    execFileSync("osascript", ["-e", `tell application id "${browser.bundle}" to quit`])
  } catch {
    return
  }
  execFileSync("sleep", ["2"])
  execFileSync("open", ["-na", browser.app, "--args", "--restore-last-session"])
}

async function extract(): Promise<Credentials> {
  const version = await fetchJSON(`${cdp}/json/version`).catch(() => undefined)
  if (!version) {
    fail(
      [
        `cannot reach ${cdp}.`,
        `Start ${browserName} with remote debugging:`,
        `  bun run creds -- --launch --browser ${browserName}`,
      ].join("\n"),
    )
  }

  const ws = await connect(version.webSocketDebuggerUrl)
  const target = await ws.send("Target.createTarget", { url: "about:blank", background: true })
  const targetID = target.result.targetId
  const attached = await ws.send("Target.attachToTarget", { targetId: targetID, flatten: true })
  const session = attached.result.sessionId

  try {
    await ws.send("Network.enable", {}, session)
    await ws.send("Page.enable", {}, session)
    await ws.send("Runtime.enable", {}, session)
    await ws.send("Page.navigate", { url: "https://www.wildberries.ru/" }, session)
    await ws.waitFor("Page.loadEventFired", session, 15000).catch(() => undefined)
    await sleep(3000)

    const token = await readToken(ws, session)
    const userdata = ws.userdata()
    if (!token) fail("no Wildberries access token found in localStorage or cookies")
    if (!userdata) {
      fail(
        "no x-userdata header captured. Open the AI chat on wildberries.ru once, then rerun.",
      )
    }

    const expiresAt = tokenExpiry(token)
    if (expiresAt && new Date(expiresAt) < new Date()) {
      fail(`token expired at ${expiresAt}. Reload wildberries.ru and sign in again.`)
    }

    return {
      token,
      userdata,
      savedAt: new Date().toISOString(),
      expiresAt,
      source: `${browserName}@${cdp}`,
    }
  } finally {
    await ws.send("Target.closeTarget", { targetId: targetID }).catch(() => undefined)
    ws.close()
  }
}

async function readToken(ws: CDP, session: string): Promise<string | undefined> {
  const keys = ["wbid-oauth-sdk-access-token"]
  for (const key of keys) {
    const value = await evaluate(ws, session, `localStorage.getItem(${JSON.stringify(key)})`)
    const token = typeof value === "string" ? value.trim() : ""
    if (token.startsWith("eyJ")) return token
  }

  const cookie = await evaluate(ws, session, `document.cookie`)
  if (typeof cookie !== "string") return
  const match = cookie.match(/(?:^|;\s*)(?:wbid-sdk-id-token|x_wbaas_token)=([^;]+)/)
  return match?.[1]
}

async function evaluate(ws: CDP, session: string, expression: string): Promise<unknown> {
  const result = await ws.send("Runtime.evaluate", { expression, returnByValue: true }, session)
  return result.result?.result?.value
}

async function check(credentials: Credentials): Promise<string> {
  const response = await fetch(upstream, {
    method: "POST",
    headers: {
      authorization: `Bearer ${credentials.token}`,
      "x-userdata": credentials.userdata,
      "content-type": "application/json",
      accept: "text/event-stream",
      "x-client": "web",
      origin: "https://www.wildberries.ru",
    },
    body: JSON.stringify({ idempotency_key: crypto.randomUUID(), text: "привет" }),
  })
  if (response.ok) return "ok"
  if (response.status === 401) return "401 credentials rejected"
  if (response.status === 429) return `429 rate limited (retry after ${response.headers.get("retry-after")}s)`
  return `${response.status} ${response.statusText}`
}

async function fetchJSON(url: string) {
  const response = await fetch(url, { signal: AbortSignal.timeout(3000) })
  if (!response.ok) return
  return (await response.json()) as { webSocketDebuggerUrl: string }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

type CDP = {
  send: (method: string, params?: Record<string, unknown>, session?: string) => Promise<any>
  waitFor: (method: string, session: string, timeout: number) => Promise<void>
  userdata: () => string
  close: () => void
}

async function connect(url: string): Promise<CDP> {
  const socket = new WebSocket(url)
  const pending = new Map<number, (value: any) => void>()
  const waiters = new Map<string, Array<() => void>>()
  let id = 0
  let userdata = ""

  socket.onmessage = (event) => {
    const message = JSON.parse(String(event.data)) as {
      id?: number
      method?: string
      params?: { headers?: Record<string, unknown> }
    }
    if (message.id && pending.has(message.id)) {
      pending.get(message.id)!(message)
      pending.delete(message.id)
      return
    }
    if (message.method === "Network.requestWillBeSentExtraInfo") {
      const headers = message.params?.headers ?? {}
      for (const [key, value] of Object.entries(headers)) {
        if (key.toLowerCase() === "x-userdata" && typeof value === "string") userdata = value
      }
    }
    if (message.method && waiters.has(message.method)) {
      for (const resolve of waiters.get(message.method)!) resolve()
      waiters.delete(message.method)
    }
  }

  await new Promise<void>((resolve, reject) => {
    socket.onopen = () => resolve()
    socket.onerror = () => reject(new Error(`cannot connect to ${url}`))
  })

  const send = (method: string, params: Record<string, unknown> = {}, session?: string) => {
    const messageID = ++id
    socket.send(JSON.stringify({ id: messageID, method, params, ...(session ? { sessionId: session } : {}) }))
    return new Promise<any>((resolve) => pending.set(messageID, resolve))
  }

  return {
    send,
    waitFor: (method, session, timeout) =>
      new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`timeout waiting for ${method}`)), timeout)
        const list = waiters.get(method) ?? []
        list.push(() => {
          clearTimeout(timer)
          resolve()
        })
        waiters.set(method, list)
      }),
    userdata: () => userdata,
    close: () => socket.close(),
  }
}
