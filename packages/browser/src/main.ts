// OpenCode Browser - Main Entry Point
// Initializes VFS, database, terminal, and agent loop

import "@xterm/xterm/css/xterm.css"
import { TerminalAdapter } from "./terminal-adapter"
import { seedDemoProject } from "./seed-project"
import { initBrowserDB, startAutoPersist, persistDB } from "./shims/db.browser"
import { BrowserAgent } from "./opencode-bootstrap"

let terminal: TerminalAdapter
let agent: BrowserAgent | null = null
let currentAbortController: AbortController | null = null

async function main() {
  // 1. Seed VFS with demo project
  seedDemoProject()

  // 2. Initialize sql.js database
  try {
    await initBrowserDB()
    startAutoPersist()
    console.log("[opencode-browser] Database initialized")
  } catch (e) {
    console.error("[opencode-browser] Failed to initialize database:", e)
  }

  // 3. Set up terminal
  const container = document.getElementById("terminal-container")!
  terminal = new TerminalAdapter({
    container,
    onMessage: handleUserMessage,
    onCancel: handleCancel,
  })

  // 4. Set up API key input
  setupApiKeyUI()

  // 5. Check for saved API key
  const savedKey = localStorage.getItem("opencode-api-key")
  if (savedKey) {
    initAgent(savedKey)
  } else {
    terminal.writeInfo("Enter your Anthropic API key above to get started.")
    terminal.writeln("")
    terminal.writeInfo("Your key is stored locally and never sent to any server except Anthropic's API.")
    terminal.writeln("")
  }
}

function setupApiKeyUI() {
  const input = document.getElementById("api-key-input") as HTMLInputElement
  const button = document.getElementById("api-key-submit") as HTMLButtonElement
  const bar = document.getElementById("api-key-bar")!

  // Check if already connected
  const savedKey = localStorage.getItem("opencode-api-key")
  if (savedKey) {
    input.value = "sk-ant-••••••••"
    button.textContent = "Reconnect"
  }

  button.addEventListener("click", () => {
    const key = input.value.trim()
    if (!key || key === "sk-ant-••••••••") return

    localStorage.setItem("opencode-api-key", key)
    input.value = "sk-ant-••••••••"
    button.textContent = "Reconnect"
    initAgent(key)
  })

  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") button.click()
  })

  // Focus input on click
  input.addEventListener("focus", () => {
    if (input.value === "sk-ant-••••••••") {
      input.value = ""
    }
  })
}

function initAgent(apiKey: string) {
  agent = new BrowserAgent(apiKey, terminal)
  terminal.writeln("")
  terminal.writeInfo("Connected! Type a message to start chatting with the AI agent.")
  terminal.writeInfo("The agent can read, write, and edit files in the demo project at /workspace.")
  terminal.writeln("")
  terminal.writeInfo("Try: \"Look at the helper functions in src/utils/helpers.ts and fix the bugs\"")
  terminal.writeln("")
  terminal.showPrompt()

  // Update status bar
  document.getElementById("session-info")!.textContent = "Ready"
}

async function handleUserMessage(message: string) {
  if (!agent) {
    terminal.writeError("No API key configured. Enter your key above.")
    terminal.showPrompt()
    return
  }

  // Update status
  document.getElementById("session-info")!.textContent = "Thinking..."

  currentAbortController = new AbortController()

  try {
    await agent.sendMessage(message, currentAbortController.signal)
  } catch (e: any) {
    if (e.name !== "AbortError") {
      terminal.writeError(e.message || "An error occurred")
    }
  } finally {
    currentAbortController = null
    document.getElementById("session-info")!.textContent = "Ready"
    terminal.showPrompt()
    await persistDB()
  }
}

function handleCancel() {
  if (currentAbortController) {
    currentAbortController.abort()
    currentAbortController = null
    terminal.writeInfo("Cancelled")
    document.getElementById("session-info")!.textContent = "Ready"
  }
}

// Boot
main().catch((e) => {
  console.error("[opencode-browser] Fatal error:", e)
  document.body.innerHTML = `<div style="padding: 20px; color: red;">
    <h2>OpenCode Browser failed to start</h2>
    <pre>${e.message}\n${e.stack}</pre>
  </div>`
})
