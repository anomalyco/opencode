// The status page (welcome.html): opened on install and as the extension's options page. Shows the install command
// and the relay connection, and offers reconnect, cleanup, and diagnostics.
import {
  AGENT_DIAGNOSTICS,
  STATUS_PORT,
  type AgentRelayState,
  type FromStatusPage,
  type ToStatusPage,
} from "../shared/protocol"

const element = <T extends HTMLElement>(id: string) => document.getElementById(id) as T
const status = element<HTMLParagraphElement>("status")
element("extension-id").textContent = chrome.runtime.id

let port: chrome.runtime.Port | undefined
const connect = () => {
  const next = chrome.runtime.connect({ name: STATUS_PORT })
  port = next
  next.onMessage.addListener((message: ToStatusPage) => {
    if (message.type === "agents") render(message.state)
  })
  // The worker can stop and restart at any time; follow it.
  next.onDisconnect.addListener(() => {
    void chrome.runtime.lastError
    if (port === next) setTimeout(connect, 300)
  })
}
connect()

const send = (message: FromStatusPage) => port?.postMessage(message)

function render(state: AgentRelayState) {
  status.dataset.state = state.status
  status.textContent = describe(state)
}

function describe(state: AgentRelayState) {
  const tabs = state.tabs.length
  if (state.status === "connected")
    return tabs ? `Connected. Agents are using ${tabs} tab${tabs === 1 ? "" : "s"}.` : "Connected. No agent is using a tab yet."
  if (state.status === "connecting") return "Connecting to the relay…"
  if (state.status === "conflict")
    return "OpenCode Browser in another browser or profile is connected. Close it there (or quit that browser), then click Reconnect."
  if (state.status === "incompatible")
    return "This extension and the installed CLI don't match. Run the install command again, then click Reconnect."
  return "Waiting for an agent. The relay starts the first time an agent uses the browse tools."
}

const flash = (button: HTMLButtonElement, label: string) => {
  const original = button.textContent
  button.textContent = label
  setTimeout(() => (button.textContent = original), 1500)
}

element<HTMLButtonElement>("copy-command").addEventListener("click", (event) => {
  const button = event.currentTarget as HTMLButtonElement
  void navigator.clipboard.writeText(element("install-command").textContent ?? "").then(() => flash(button, "Copied"))
})
element<HTMLButtonElement>("reconnect").addEventListener("click", () => send({ type: "agents.reconnect" }))
element<HTMLButtonElement>("cleanup").addEventListener("click", (event) => {
  send({ type: "tabs.cleanup" })
  flash(event.currentTarget as HTMLButtonElement, "Closed")
})
element<HTMLButtonElement>("diagnostics").addEventListener("click", (event) => {
  const button = event.currentTarget as HTMLButtonElement
  void chrome.runtime
    .sendMessage({ action: AGENT_DIAGNOSTICS })
    .then((response: { text?: string } | undefined) => navigator.clipboard.writeText(response?.text ?? "No diagnostics."))
    .then(() => flash(button, "Copied"))
})
