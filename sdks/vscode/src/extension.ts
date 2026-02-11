// This method is called when your extension is deactivated
export function deactivate() {}

import * as vscode from "vscode"
import { parseSSELines, isBrowserOpen, createDeduplicator } from "./sse"

const TERMINAL_NAME = "opencode"

const sseConnections = new Map<vscode.Terminal, AbortController>()
const dedup = createDeduplicator()
const log = vscode.window.createOutputChannel("opencode", { log: true })

export function activate(context: vscode.ExtensionContext) {
  context.subscriptions.push(log)
  let openNewTerminalDisposable = vscode.commands.registerCommand("opencode.openNewTerminal", async () => {
    await openTerminal()
  })

  let openTerminalDisposable = vscode.commands.registerCommand("opencode.openTerminal", async () => {
    // An opencode terminal already exists => focus it
    const existingTerminal = vscode.window.terminals.find((t: vscode.Terminal) => t.name === TERMINAL_NAME)
    if (existingTerminal) {
      existingTerminal.show()
      return
    }

    await openTerminal()
  })

  let addFilepathDisposable = vscode.commands.registerCommand("opencode.addFilepathToTerminal", async () => {
    const fileRef = getActiveFile()
    if (!fileRef) {
      return
    }

    const terminal = vscode.window.activeTerminal
    if (!terminal) {
      return
    }

    if (terminal.name === TERMINAL_NAME) {
      const options = terminal.creationOptions as vscode.TerminalOptions
      const port = options.env?.["_EXTENSION_OPENCODE_PORT"]
      port ? await appendPrompt(parseInt(port), fileRef) : terminal.sendText(fileRef, false)
      terminal.show()
    }
  })

  context.subscriptions.push(openTerminalDisposable, addFilepathDisposable, openNewTerminalDisposable)

  const terminalCloseListener = vscode.window.onDidCloseTerminal((terminal: vscode.Terminal) => {
    const controller = sseConnections.get(terminal)
    if (controller) {
      controller.abort()
      sseConnections.delete(terminal)
    }
  })
  context.subscriptions.push(terminalCloseListener)

  async function connectSSE(port: number, terminal: vscode.Terminal, signal: AbortSignal) {
    let backoff = 1000
    const maxBackoff = 30000

    async function connect() {
      if (signal.aborted) return

      log.info(`[sse] connecting to http://localhost:${port}/global/event`)
      const response = await fetch(`http://localhost:${port}/global/event`, { signal }).catch((e) => {
        log.debug(`[sse] fetch failed: ${e}`)
        return null
      })
      if (!response || !response.body) {
        if (signal.aborted) return
        log.debug(`[sse] no response, retrying in ${backoff}ms`)
        await new Promise((resolve) => setTimeout(resolve, backoff))
        backoff = Math.min(backoff * 2, maxBackoff)
        return connect()
      }

      log.info(`[sse] connected to port ${port}`)
      backoff = 1000
      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ""

      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break

          buffer += decoder.decode(value, { stream: true })
          const result = parseSSELines(buffer)
          buffer = result.remainder

          for (const event of result.events) {
            log.debug(`[sse] event: ${event.type}`)
            if (!isBrowserOpen(event)) continue

            const url = event.properties.url
            const callbackPort = event.properties.callbackPort
            log.info(`[sse] browser.open event: url=${url}, callbackPort=${callbackPort}`)

            if (dedup.isDuplicate(url)) {
              log.debug(`[sse] duplicate url, skipping`)
              continue
            }

            if (callbackPort) {
              log.info(`[sse] calling asExternalUri for callback port ${callbackPort}`)
              const mapped = await vscode.env.asExternalUri(vscode.Uri.parse(`http://127.0.0.1:${callbackPort}`))
              log.info(`[sse] asExternalUri result: ${mapped.toString()}`)
            }

            log.info(`[sse] calling openExternal: ${url}`)
            const opened = await vscode.env.openExternal(vscode.Uri.parse(url))
            log.info(`[sse] openExternal result: ${opened}`)
          }
        }
      } catch (e) {
        if (signal.aborted) return
        log.error(`[sse] stream error: ${e}`)
      }

      if (!signal.aborted) {
        log.info(`[sse] stream ended, reconnecting in ${backoff}ms`)
        await new Promise((resolve) => setTimeout(resolve, backoff))
        backoff = Math.min(backoff * 2, maxBackoff)
        return connect()
      }
    }

    connect().catch((e) => log.error(`[sse] connect failed: ${e}`))
  }

  async function openTerminal() {
    // Create a new terminal in split screen
    const port = Math.floor(Math.random() * (65535 - 16384 + 1)) + 16384
    const terminal = vscode.window.createTerminal({
      name: TERMINAL_NAME,
      iconPath: {
        light: vscode.Uri.file(context.asAbsolutePath("images/button-dark.svg")),
        dark: vscode.Uri.file(context.asAbsolutePath("images/button-light.svg")),
      },
      location: {
        viewColumn: vscode.ViewColumn.Beside,
        preserveFocus: false,
      },
      env: {
        _EXTENSION_OPENCODE_PORT: port.toString(),
        OPENCODE_CALLER: "vscode",
      },
    })

    terminal.show()
    terminal.sendText(`opencode --port ${port}`)

    const controller = new AbortController()
    sseConnections.set(terminal, controller)
    connectSSE(port, terminal, controller.signal)

    const fileRef = getActiveFile()
    if (!fileRef) {
      return
    }

    // Wait for the terminal to be ready
    let tries = 10
    let connected = false
    do {
      await new Promise((resolve) => setTimeout(resolve, 200))
      try {
        await fetch(`http://localhost:${port}/app`)
        connected = true
        break
      } catch (e) {}

      tries--
    } while (tries > 0)

    // If connected, append the prompt to the terminal
    if (connected) {
      await appendPrompt(port, `In ${fileRef}`)
      terminal.show()
    }
  }

  async function appendPrompt(port: number, text: string) {
    await fetch(`http://localhost:${port}/tui/append-prompt`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ text }),
    })
  }

  function getActiveFile() {
    const activeEditor = vscode.window.activeTextEditor
    if (!activeEditor) {
      return
    }

    const document = activeEditor.document
    const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri)
    if (!workspaceFolder) {
      return
    }

    // Get the relative path from workspace root
    const relativePath = vscode.workspace.asRelativePath(document.uri)
    let filepathWithAt = `@${relativePath}`

    // Check if there's a selection and add line numbers
    const selection = activeEditor.selection
    if (!selection.isEmpty) {
      // Convert to 1-based line numbers
      const startLine = selection.start.line + 1
      const endLine = selection.end.line + 1

      if (startLine === endLine) {
        // Single line selection
        filepathWithAt += `#L${startLine}`
      } else {
        // Multi-line selection
        filepathWithAt += `#L${startLine}-${endLine}`
      }
    }

    return filepathWithAt
  }
}
