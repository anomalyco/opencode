import { existsSync } from "node:fs"
import { join } from "node:path"

const managerSessionID = "ses_manager_agent"
const managerTitle = "管理agent"
const port = Number(process.env.OPENCODE_MANAGER_DEV_PORT ?? 17686)

const sidecarPath = join(process.env.APPDATA ?? join(process.env.USERPROFILE ?? "", "AppData", "Roaming"), "ai.opencode.desktop.dev", "sidecar.json")

if (!existsSync(sidecarPath)) {
  console.error(`sidecar connection file not found: ${sidecarPath}`)
  console.error("Start dev:desktop once after this change, then run this command again.")
  process.exit(1)
}

const sidecar = await Bun.file(sidecarPath).json() as { url: string; username?: string; password?: string }
const auth = sidecar.password ? `Basic ${btoa(`${sidecar.username ?? "opencode"}:${sidecar.password}`)}` : undefined

const html = String.raw`<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>管理agent</title>
    <style>
      * { box-sizing: border-box; }
      body { margin: 0; font: 14px/1.5 ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: #d8dee9; background: #101318; }
      header { display: flex; gap: 12px; align-items: end; justify-content: space-between; padding: 14px 18px; border-bottom: 1px solid #2a2f3a; background: #151922; }
      h1 { margin: 0; font-size: 18px; }
      .muted { color: #8f98a8; font-size: 12px; }
      label { display: grid; gap: 4px; color: #b8c0cc; font-size: 12px; }
      select, input, button { border: 1px solid #343b49; border-radius: 8px; background: #10141c; color: #e8edf5; padding: 8px 10px; }
      button { cursor: pointer; background: #2f6feb; border-color: #2f6feb; }
      button:disabled { cursor: not-allowed; opacity: .55; }
      main { height: calc(100vh - 142px); overflow: auto; padding: 18px; }
      .list { max-width: 860px; margin: 0 auto; display: grid; gap: 12px; }
      .msg { padding: 12px 14px; border-radius: 14px; white-space: pre-wrap; border: 1px solid #2a2f3a; background: #151922; }
      .user { margin-left: 48px; background: #1d2636; }
      .assistant { margin-right: 48px; }
      footer { display: flex; gap: 10px; padding: 14px 18px; border-top: 1px solid #2a2f3a; background: #151922; }
      #draft { flex: 1; }
      #error { color: #ff7b72; padding: 0 18px 10px; min-height: 20px; }
    </style>
  </head>
  <body>
    <header>
      <div>
        <h1>管理agent</h1>
        <div class="muted">固定会话：ses_manager_agent · sidecar: <span id="sidecar"></span></div>
      </div>
      <label>模型<select id="model"></select></label>
    </header>
    <main><div id="messages" class="list"><div class="muted">正在加载...</div></div></main>
    <div id="error"></div>
    <footer>
      <input id="draft" placeholder="输入要管理的事项..." />
      <button id="send">发送</button>
    </footer>
    <script>
      const managerSessionID = "ses_manager_agent"
      const managerTitle = "管理agent"
      const sidecar = document.getElementById("sidecar")
      const messages = document.getElementById("messages")
      const model = document.getElementById("model")
      const draft = document.getElementById("draft")
      const send = document.getElementById("send")
      const error = document.getElementById("error")
      sidecar.textContent = location.origin

      const id = (prefix) => prefix + "_" + Date.now().toString(36) + Math.random().toString(36).slice(2).padEnd(18, "0")
      const api = async (path, options = {}) => {
        const res = await fetch("/api" + path, { ...options, headers: { "content-type": "application/json", ...(options.headers || {}) } })
        if (!res.ok) throw new Error(await res.text() || res.statusText)
        if (res.status === 204) return undefined
        return res.json()
      }
      const data = (value) => value && "data" in value ? value.data : value
      const partText = (part) => part.type === "text" ? part.text : ""
      const messageText = (message) => (message.parts || []).map(partText).filter(Boolean).join("\n").trim()

      async function ensureSession() {
        try {
          await api("/session/" + managerSessionID)
        } catch {
          await api("/session", { method: "POST", body: JSON.stringify({ id: managerSessionID, title: managerTitle, agent: "build" }) })
        }
      }

      async function loadModels() {
        const providers = data(await api("/provider")) || { all: [], connected: [] }
        const connected = new Set(providers.connected || [])
        const options = (providers.all || []).flatMap((provider) => {
          if (!connected.has(provider.id)) return []
          return Object.values(provider.models || {}).map((m) => ({ provider, model: m }))
        })
        model.innerHTML = options.map((item) => '<option value="' + item.provider.id + '/' + item.model.id + '">' + item.provider.name + ' / ' + item.model.name + '</option>').join("")
      }

      async function loadMessages() {
        const list = data(await api("/session/" + managerSessionID + "/message")) || []
        messages.innerHTML = list.length ? "" : '<div class="muted">开始和管理 agent 对话。</div>'
        for (const message of list) {
          const text = messageText(message)
          if (!text) continue
          const div = document.createElement("div")
          div.className = "msg " + (message.info?.role === "user" ? "user" : "assistant")
          div.textContent = text
          messages.appendChild(div)
        }
      }

      async function submit() {
        const text = draft.value.trim()
        const selected = model.value.split("/")
        if (!text || selected.length !== 2) return
        send.disabled = true
        error.textContent = ""
        draft.value = ""
        try {
          await api("/session/" + managerSessionID + "/prompt_async", {
            method: "POST",
            body: JSON.stringify({
              agent: "build",
              messageID: id("msg"),
              model: { providerID: selected[0], modelID: selected[1] },
              parts: [{ id: id("prt"), type: "text", text }],
            }),
          })
          await loadMessages()
        } catch (err) {
          draft.value = text
          error.textContent = err instanceof Error ? err.message : String(err)
        } finally {
          send.disabled = false
        }
      }

      send.addEventListener("click", submit)
      draft.addEventListener("keydown", (event) => { if (event.key === "Enter") submit() })
      ;(async () => {
        try {
          await ensureSession()
          await loadModels()
          await loadMessages()
          setInterval(() => loadMessages().catch(() => {}), 1500)
        } catch (err) {
          error.textContent = err instanceof Error ? err.message : String(err)
        }
      })()
    </script>
  </body>
</html>`

const server = Bun.serve({
  hostname: "127.0.0.1",
  port,
  async fetch(request) {
    const url = new URL(request.url)
    if (url.pathname === "/") return new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } })
    if (!url.pathname.startsWith("/api/")) return new Response("not found", { status: 404 })

    const target = new URL(url.pathname.slice(4) + url.search, sidecar.url)
    const response = await fetch(target, {
      method: request.method,
      headers: {
        ...(auth ? { authorization: auth } : {}),
        "content-type": request.headers.get("content-type") ?? "application/json",
      },
      body: request.method === "GET" || request.method === "HEAD" ? undefined : await request.text(),
    })
    const headers = new Headers(response.headers)
    headers.delete("content-encoding")
    headers.delete("content-length")
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers })
  },
})

console.log(`manager dev frontend: http://127.0.0.1:${server.port}`)
console.log(`proxying sidecar: ${sidecar.url}`)

const opener = process.platform === "win32" ? ["cmd", "/c", "start", "", `http://127.0.0.1:${server.port}`] : process.platform === "darwin" ? ["open", `http://127.0.0.1:${server.port}`] : ["xdg-open", `http://127.0.0.1:${server.port}`]
Bun.spawn(opener, { stdout: "ignore", stderr: "ignore" })

await new Promise(() => {})
