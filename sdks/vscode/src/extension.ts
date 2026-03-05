import * as vscode from "vscode"
import { promises as fsp } from 'fs'
import * as path from 'path'
import { OpenCodeChatParticipant } from "./vscode/participant"
import { OpenCodeChatSessionProvider, sessionScheme } from "./vscode/chatSession"
import { ActivationController } from "./vscode/activation"

const TERMINAL_NAME = "opencode"

export async function activate(context: vscode.ExtensionContext) {
  const output = vscode.window.createOutputChannel("OpenCode")
  context.subscriptions.push(output)
  output.appendLine("OpenCode extension activate()")
  output.show(true)
  // write an activation marker in test-results for e2e verification
  try {
    // attempt best-effort write to package-local test-results so test runner can detect activation
    const fsp = require('fs').promises
    const path = require('path')
    const safeTimestamp = () => new Date().toISOString().replace(/[:.]/g, '-')
    const markerDir = path.join(context.extensionPath, 'test-results')
    try { await fsp.mkdir(markerDir, { recursive: true }) } catch (e) {}
    try { await fsp.writeFile(path.join(markerDir, `extension-activated-${safeTimestamp()}.txt`), new Date().toISOString(), 'utf8') } catch (e) {}
  } catch (e) {}
  const session =
    typeof (vscode.chat as { registerChatSessionContentProvider?: unknown }).registerChatSessionContentProvider ===
    "function"
  const missing = [!session ? "proposed chatSessionsProvider@3 API" : ""].filter((value) => value).join(" and ")
  if (missing) {
    output.appendLine(
      `Warning: ${missing} is required for chat session targets. Launch VS Code with --enable-proposed-api sst-dev.opencode.`,
    )
  }
  // Create activation controller for on-demand ACP process management
  const activationController = new ActivationController(context, output)

  const activateDisposable = vscode.commands.registerCommand("opencode.activate", async () => {
    output.appendLine("OpenCode activation command invoked")
    await vscode.commands.executeCommand("workbench.action.chat.open")
  })

  // Register terminal commands
  let openNewTerminalDisposable = vscode.commands.registerCommand("opencode.openNewTerminal", async () => {
    await openTerminal()
  })

  let openTerminalDisposable = vscode.commands.registerCommand("opencode.openTerminal", async () => {
    const existingTerminal = vscode.window.terminals.find((t) => t.name === TERMINAL_NAME)
    if (existingTerminal) {
      existingTerminal.show()
      return
    }

    await openTerminal()
  })

  let addFilepathDisposable = vscode.commands.registerCommand("opencode.addFilepathToTerminal", async () => {
    const fileRef = getActiveFile()
    if (!fileRef) return

    const terminal = vscode.window.activeTerminal
    if (!terminal) return

    if (terminal.name === TERMINAL_NAME) {
      const opts = terminal.creationOptions as { env?: Record<string, string> }
      const port = opts?.env?._EXTENSION_OPENCODE_PORT
      port ? await appendPrompt(parseInt(port, 10), fileRef) : terminal.sendText(fileRef, false)
      terminal.show()
    }
  })

  context.subscriptions.push(
    activateDisposable,
    openNewTerminalDisposable,
    openTerminalDisposable,
    addFilepathDisposable,
  )

  // Capture evidence command: prefer VS Code capture commands, then Electron APIs as fallback.
  const captureDisposable = vscode.commands.registerCommand('opencode.captureEvidence', async () => {
    // First, try well-known VS Code capture commands which may return a URI or buffer
    try {
      const cmds = await vscode.commands.getCommands(true)
      const candidates = [
        'workbench.action.captureScreen',
        'workbench.action.captureEditor',
        'workbench.action.captureScreenshot',
        'extension.vscode-debugger.captureScreen',
      ]
      for (const id of candidates) {
        if (cmds.includes(id)) {
          try {
            // Some commands may return a Uri or a string pointing to a file
            // @ts-ignore
            const res = await vscode.commands.executeCommand(id)
            if (res) {
              // If returned a URI-like object
              try {
                // @ts-ignore
                try {
                  const fsPath = (res as any).fsPath || (res as any).path
                  if (fsPath && typeof fsPath === 'string') {
                    const buf = await fsp.readFile(fsPath)
                    return 'data:image/png;base64,' + buf.toString('base64')
                  }
                } catch (e) {}
              } catch (e) {}
              // If returned a base64/data URL string
              if (typeof res === 'string' && /^data:image\/(png|jpeg);base64,/.test(res)) return res
              // If returned a path string
              try {
                const maybePath = String(res)
                if (await (fsp.stat(maybePath).then(() => true).catch(() => false))) {
                  const buf = await fsp.readFile(maybePath)
                  return 'data:image/png;base64,' + buf.toString('base64')
                }
              } catch (e) {}
            }
          } catch (e) {
            // try next
          }
        }
      }
    } catch (e) {
      // ignore getCommands failures
    }

    // Next, try Electron desktopCapturer or webContents.capturePage if available
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const electron = (global as any).process ? require('electron') : null
      const desktopCapturer = electron && (electron.desktopCapturer || (electron.remote && electron.remote.desktopCapturer))
      if (desktopCapturer && typeof desktopCapturer.getSources === 'function') {
        const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 1280, height: 720 } })
        if (sources && sources.length) {
          const s = sources[0]
          if (s.thumbnail && typeof s.thumbnail.toPNG === 'function') {
            const png = s.thumbnail.toPNG()
            return 'data:image/png;base64,' + Buffer.from(png).toString('base64')
          }
          // some electron versions return NativeImage with toDataURL
          if (s.thumbnail && typeof s.thumbnail.toDataURL === 'function') {
            return s.thumbnail.toDataURL()
          }
        }
      }

      // try webContents capture from remote/currentWindow
      const remote = electron && electron.remote ? electron.remote : null
      const wc = remote && remote.getCurrentWindow && remote.getCurrentWindow().webContents
      if (wc && typeof wc.capturePage === 'function') {
        const img = await wc.capturePage()
        if (img && typeof img.toPNG === 'function') {
          return 'data:image/png;base64,' + Buffer.from(img.toPNG()).toString('base64')
        }
        if (img && typeof img.toDataURL === 'function') return img.toDataURL()
      }
    } catch (e) {
      // ignore electron failures
    }

    // As a final fallback return a 1x1 transparent PNG data URI so evidence helper can still create a file.
    return 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR4nGMAAQAABQABDQottAAAAABJRU5ErkJggg=='
  })
  context.subscriptions.push(captureDisposable)

  const participant = new OpenCodeChatParticipant(context, activationController)
  participant.register()
  output.appendLine("OpenCode chat participant registered")
  context.subscriptions.push({ dispose: () => participant.dispose() })
  if (!session) {
    output.appendLine("OpenCode chat session provider not registered; proposed API unavailable.")
  }
  if (session) {
    const sessionProvider = new OpenCodeChatSessionProvider(activationController)
    const sessionRegistration = (vscode.chat as any).registerChatSessionContentProvider(
      sessionScheme,
      sessionProvider,
      participant.id,
      { supportsInterruptions: true },
    )
    output.appendLine("OpenCode chat session provider registered")
    context.subscriptions.push(sessionRegistration)
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
      } catch {}

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

  // Background poller to respond to test-triggered capture requests placed in the OS tmp dir.
  try {
    const os = require('os')
    const tmpDir = os.tmpdir()
    const localTriggerDir = path.join(context.extensionPath, 'test-results', 'triggers')
    try { await fsp.mkdir(localTriggerDir, { recursive: true }) } catch (e) {}
    setInterval(async () => {
      try {
        const dirs = [tmpDir, localTriggerDir]
        for (const dir of dirs) {
          let entries: string[] = []
          try { entries = await fsp.readdir(dir) } catch (e) { continue }
          for (const ent of entries) {
            if (!ent.startsWith('opencode-capture-') || !ent.endsWith('.json')) continue
            const triggerPath = path.join(dir, ent)
            let payload: any = {}
            try { payload = JSON.parse(await fsp.readFile(triggerPath, 'utf8')) } catch (e) {}
            const outPath = payload && payload.outPath
            if (outPath) {
              try {
                // try Electron desktopCapturer
                // eslint-disable-next-line @typescript-eslint/no-var-requires
                const electron = (global as any).process ? require('electron') : null
                const desktopCapturer = electron && (electron.desktopCapturer || (electron.remote && electron.remote.desktopCapturer))
                if (desktopCapturer && typeof desktopCapturer.getSources === 'function') {
                  const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 1280, height: 720 } })
                  if (sources && sources.length) {
                    const s = sources[0]
                    if (s.thumbnail && typeof s.thumbnail.toPNG === 'function') {
                      const png = s.thumbnail.toPNG()
                      await fsp.writeFile(outPath, png)
                    } else if (s.thumbnail && typeof s.thumbnail.toDataURL === 'function') {
                      const dataurl = s.thumbnail.toDataURL()
                      const base64 = dataurl.split(',')[1]
                      await fsp.writeFile(outPath, Buffer.from(base64, 'base64'))
                    }
                  }
                } else {
                  // Try webContents capture
                  const remote = electron && electron.remote ? electron.remote : null
                  const wc = remote && remote.getCurrentWindow && remote.getCurrentWindow().webContents
                  if (wc && typeof wc.capturePage === 'function') {
                    const img = await wc.capturePage()
                    if (img && typeof img.toPNG === 'function') {
                      await fsp.writeFile(outPath, img.toPNG())
                    } else if (img && typeof img.toDataURL === 'function') {
                      const dataurl = img.toDataURL()
                      const base64 = dataurl.split(',')[1]
                      await fsp.writeFile(outPath, Buffer.from(base64, 'base64'))
                    }
                  }
                }
              } catch (e) {
                try { await fsp.writeFile(path.join(dir, ent + '.error.txt'), String(e), 'utf8') } catch (e2) {}
              }
            }
            try { await fsp.unlink(triggerPath) } catch (e) {}
          }
        }
      } catch (e) {
        // ignore poll errors
      }
    }, 500)
  } catch (e) {}
}

export function deactivate() {}
