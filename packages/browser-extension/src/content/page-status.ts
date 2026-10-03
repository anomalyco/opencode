// In-page status for tabs Browser Control sessions use: a small pill while a session runs, and a
// "your turn" card when a session hands the page to the user (logins, 2FA, passkeys, payments).
// Ported from anomalyco/browser-control extension/src/content-script.ts with opencode's look. Built as a
// classic script (content scripts cannot import modules) and injected at document_start on every page.
import { pageStatusFromJson, type PageStatus } from "../browser-control/protocol"

const HOST_ID = "__opencode_browser_status__"
const CURSOR_STYLE_ID = "__opencode_browser_cursor_style__"
const RELAY_CURSOR_ID = "__browser_control_ghost_cursor__"

let current: PageStatus | undefined
let completing: string | undefined
let observer: MutationObserver | undefined

chrome.runtime.onMessage.addListener((message: unknown) => {
  if (typeof message !== "object" || message === null || !("action" in message)) return
  if (message.action === "page-status.clear") return clear()
  const status = "status" in message ? pageStatusFromJson(message.status) : undefined
  if (message.action !== "page-status.set" || !status) return
  current = status
  completing = undefined
  render()
})

void chrome.runtime.sendMessage({ action: "page-status.ready" }).catch(() => undefined)

function render() {
  if (!current || !document.documentElement) return
  styleRelayCursor()
  const host = document.getElementById(HOST_ID) ?? create()
  const root = host.shadowRoot!
  const waiting = current.state === "waiting" && current.handoffId !== undefined
  host.dataset.waiting = String(waiting)
  const pill = root.getElementById("pill")!
  const label = root.getElementById("label")!
  pill.dataset.state = current.readOnly ? "readonly" : current.state
  label.textContent =
    current.state === "waiting"
      ? "Waiting for you"
      : current.readOnly
        ? "Watching"
        : current.state === "running"
          ? "Working"
          : "Connected"
  pill.title = [
    current.owner === "session" ? "A Browser Control session opened this tab" : "You shared this tab with Browser Control",
    current.sessionId ? `Session ${current.sessionId}` : undefined,
  ]
    .filter(Boolean)
    .join(" · ")
  const card = root.getElementById("card")!
  card.hidden = !waiting
  root.getElementById("vignette")!.hidden = !waiting
  if (waiting) {
    root.getElementById("message")!.textContent = current.message ?? "Finish this step, then continue."
    const button = root.getElementById("continue") as HTMLButtonElement
    button.disabled = completing === current.handoffId
    button.textContent = completing === current.handoffId ? "Continuing…" : "Continue"
    anchor(host)
  }
  if (!host.isConnected) document.documentElement.append(host)
  observer ??= new MutationObserver(() => {
    if (current && !document.getElementById(HOST_ID)) render()
  })
  observer.observe(document.documentElement, { childList: true })
}

function create() {
  const host = document.createElement("div")
  host.id = HOST_ID
  const root = host.attachShadow({ mode: "open" })
  root.innerHTML = `<style>${STYLE}</style>
    <div id="vignette" hidden></div>
    <div id="card" role="dialog" aria-labelledby="title" aria-describedby="message" hidden>
      <div id="head"><span id="dot"></span><span id="title">Your turn</span><span id="source">${MARK}Browser Control</span></div>
      <p id="message"></p>
      <div id="actions"><button id="continue" type="button">Continue</button></div>
    </div>
    <div id="pill" role="status" aria-live="polite">${MARK}<span id="label"></span><span id="light"></span></div>`
  root.getElementById("continue")!.addEventListener("click", () => {
    const handoffId = current?.handoffId
    if (!handoffId || completing === handoffId) return
    completing = handoffId
    render()
    void chrome.runtime.sendMessage({ action: "handoff.complete", handoffId }).catch(() => {
      completing = undefined
      render()
    })
  })
  return host
}

/** Places the card next to Browser Control's cursor when it points at the step to finish. */
function anchor(host: HTMLElement) {
  const cursor = document.getElementById(RELAY_CURSOR_ID)
  const x = Number(cursor?.dataset.targetX)
  const y = Number(cursor?.dataset.targetY)
  if (!cursor || !Number.isFinite(x) || !Number.isFinite(y)) {
    host.removeAttribute("data-anchor")
    return
  }
  const width = 320
  const height = 140
  host.style.setProperty("--card-left", `${Math.max(12, Math.min(x + 20, innerWidth - width - 12))}px`)
  host.style.setProperty("--card-top", `${y + 28 + height <= innerHeight ? y + 28 : Math.max(12, y - height - 20)}px`)
  host.dataset.anchor = "cursor"
}

/** Browser Control's relay draws its own purple cursor; give it OpenCode Browser's look. */
function styleRelayCursor() {
  if (document.getElementById(CURSOR_STYLE_ID)) return
  const style = document.createElement("style")
  style.id = CURSOR_STYLE_ID
  style.textContent = `#${RELAY_CURSOR_ID} path { fill: #131313 !important; stroke: #fff !important; stroke-width: 1.4px !important; }`
  ;(document.head ?? document.documentElement).append(style)
}

function clear() {
  current = undefined
  completing = undefined
  observer?.disconnect()
  observer = undefined
  document.getElementById(HOST_ID)?.remove()
}

const MARK = `<svg class="mark" viewBox="0 0 16 20" width="9" height="11" aria-hidden="true"><path d="M12 16H4V8h8v8Z" fill="currentColor" opacity=".45"/><path d="M12 4H4v12h8V4Zm4 16H0V0h16v20Z" fill="currentColor"/></svg>`

// Colors follow the color scheme preference; the page itself may be light or dark either way, so both
// surfaces are opaque enough to read on anything. Fonts are system fonts only: a page's own @font-face
// rules apply inside the shadow root, so a family like "Inter" could resolve to the site's file.
const STYLE = `
  :host { all: initial !important; position: fixed !important; right: 12px !important; bottom: 12px !important;
    z-index: 2147483647 !important; pointer-events: none !important; }
  :host([data-waiting="true"]) { inset: 0 !important; }
  * { box-sizing: border-box; }
  #pill, #card { --bg: #161616; --fg: #ededed; --muted: #a0a0a0; --faint: #707070; --ring: rgba(255,255,255,.09);
    --running: #f5a524; --waiting: #4c8dff; --idle: #7a7a7a; --button: #ededed; --button-fg: #111; --button-hover: #fff;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif; font-style: normal;
    font-synthesis: none; text-transform: none; text-align: left; -webkit-font-smoothing: antialiased; color: var(--fg); }
  #pill { position: absolute; right: 0; bottom: 0; display: inline-flex; align-items: center; gap: 7px; height: 26px;
    padding: 0 10px 0 9px; border-radius: 999px; background: color-mix(in srgb, var(--bg) 92%, transparent);
    box-shadow: 0 0 0 1px var(--ring), 0 6px 16px rgba(0,0,0,.22); backdrop-filter: blur(10px);
    font-size: 12px; font-weight: 500; line-height: 26px; letter-spacing: -.01em; white-space: nowrap; }
  :host([data-waiting="true"]) #pill { right: 12px; bottom: 12px; }
  .mark { flex: none; display: block; }
  #pill .mark { color: var(--fg); }
  #label { display: block; }
  #light { flex: none; width: 6px; height: 6px; border-radius: 999px; background: var(--idle); }
  #pill[data-state="running"] #light { background: var(--running); box-shadow: 0 0 0 3px color-mix(in srgb, var(--running) 22%, transparent);
    animation: pulse 1.6s ease-in-out infinite; }
  #pill[data-state="waiting"] #light { background: var(--waiting); box-shadow: 0 0 0 3px color-mix(in srgb, var(--waiting) 24%, transparent); }
  #vignette { position: absolute; inset: 0; pointer-events: none; box-shadow: inset 0 0 0 2px rgba(76,141,255,.55), inset 0 0 80px rgba(76,141,255,.10);
    animation: fade .3s ease-out both; }
  #card { position: absolute; right: 12px; bottom: 48px; width: 320px; max-width: calc(100vw - 24px); padding: 12px 12px 12px 14px;
    border-radius: 12px; background: var(--bg); pointer-events: auto; user-select: text;
    box-shadow: 0 0 0 1px var(--ring), 0 18px 44px rgba(0,0,0,.34); animation: enter .22s cubic-bezier(.2,.8,.2,1) both; }
  :host([data-anchor="cursor"]) #card { left: var(--card-left); top: var(--card-top); right: auto; bottom: auto; }
  #head { display: flex; align-items: center; gap: 8px; height: 20px; }
  #dot { flex: none; width: 7px; height: 7px; border-radius: 999px; background: var(--waiting);
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--waiting) 24%, transparent); }
  #title { font-size: 13px; font-weight: 600; line-height: 20px; letter-spacing: -.01em; }
  #source { margin-left: auto; display: inline-flex; align-items: center; gap: 5px; color: var(--faint); font-size: 11.5px;
    font-weight: 500; line-height: 20px; }
  #source .mark { width: 7px; height: 9px; }
  #message { margin: 6px 0 12px; color: var(--muted); font-size: 13px; line-height: 19px; overflow-wrap: anywhere; }
  #actions { display: flex; justify-content: flex-end; }
  #continue { all: unset; box-sizing: border-box; cursor: pointer; height: 28px; padding: 0 12px; border-radius: 7px;
    background: var(--button); color: var(--button-fg); font-family: inherit; font-size: 13px; font-weight: 500; line-height: 28px;
    transition: background-color .12s; }
  #continue:hover { background: var(--button-hover); }
  #continue:focus-visible { outline: 2px solid var(--waiting); outline-offset: 2px; }
  #continue:disabled { cursor: default; opacity: .6; }
  @media (prefers-color-scheme: light) {
    #pill, #card { --bg: #ffffff; --fg: #171717; --muted: #5f5f5f; --faint: #8f8f8f; --ring: rgba(0,0,0,.09);
      --running: #d97706; --waiting: #2563eb; --idle: #a3a3a3; --button: #171717; --button-fg: #fff; --button-hover: #000; }
    #pill { box-shadow: 0 0 0 1px var(--ring), 0 6px 16px rgba(0,0,0,.10); }
    #card { box-shadow: 0 0 0 1px var(--ring), 0 18px 44px rgba(0,0,0,.14); }
  }
  @keyframes pulse { 50% { opacity: .45; } }
  @keyframes fade { from { opacity: 0; } }
  @keyframes enter { from { opacity: 0; transform: translateY(6px) scale(.98); } }
  @media (prefers-reduced-motion: reduce) { #light, #card, #vignette { animation: none !important; } }
`
