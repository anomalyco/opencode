import { existsSync } from "node:fs"
import * as path from "node:path"
import * as vscode from "vscode"

const TERMINAL_NAME = "opencode"
const output = vscode.window.createOutputChannel("opencode")

type Sel = {
  startLine: number
  endLine: number
}

type Item = {
  path: string
  active: boolean
  selection?: Sel
}

class Files {
  private map = new Map<string, Item>()
  private active: string | undefined
  private readonly change = new vscode.EventEmitter<void>()
  readonly onDidChange = this.change.event

  constructor(ctx: vscode.ExtensionContext) {
    ctx.subscriptions.push(
      vscode.window.onDidChangeActiveTextEditor((editor) => {
        if (!editor) {
          return
        }
        this.upsert(editor)
        this.setActive(editor.document.uri.fsPath)
        this.emit()
      }),
      vscode.window.onDidChangeTextEditorSelection((event) => {
        this.upsert(event.textEditor)
        if (event.textEditor.document.uri.fsPath === this.active) {
          this.setActive(event.textEditor.document.uri.fsPath)
        }
        this.emit()
      }),
      vscode.window.onDidChangeVisibleTextEditors((editors) => {
        editors.forEach((editor) => this.upsert(editor))
        this.prune()
        this.emit()
      }),
      vscode.workspace.onDidCloseTextDocument((doc) => {
        this.map.delete(doc.uri.fsPath)
        if (this.active === doc.uri.fsPath) {
          this.active = undefined
        }
        this.prune()
        this.emit()
      }),
    )

    vscode.window.visibleTextEditors.forEach((editor) => this.upsert(editor))
    if (vscode.window.activeTextEditor) {
      this.upsert(vscode.window.activeTextEditor)
      this.setActive(vscode.window.activeTextEditor.document.uri.fsPath)
    }
    this.prune()
  }

  snapshot(include: boolean) {
    const files: Item[] = []
    const active = this.getActive()
    if (active) {
      files.push(active)
    }
    if (include) {
      files.push(...this.getOpen())
    }
    return files
  }

  getActive() {
    if (!this.active) {
      return undefined
    }
    const item = this.map.get(this.active)
    if (!item) {
      return undefined
    }
    return { ...item, active: true }
  }

  getOpen() {
    return Array.from(this.tabs())
      .filter((file) => file !== this.active)
      .flatMap((file) => {
        const item = this.map.get(file)
        if (item) {
          return [{ ...item, active: false }]
        }

        const rel = this.rel(vscode.Uri.file(file))
        if (!rel) {
          return []
        }

        return [{ path: rel, active: false }]
      })
  }

  private emit() {
    this.change.fire()
  }

  private setActive(file: string) {
    this.active = file
    for (const [key, item] of this.map.entries()) {
      item.active = key === file
    }
  }

  private prune() {
    const tabs = this.tabs()
    for (const [file] of this.map.entries()) {
      if (file === this.active) {
        continue
      }
      if (!tabs.has(file)) {
        this.map.delete(file)
      }
    }
  }

  private tabs() {
    const tabs = new Set<string>()
    for (const group of vscode.window.tabGroups.all) {
      for (const tab of group.tabs) {
        if (tab.input instanceof vscode.TabInputText) {
          tabs.add(tab.input.uri.fsPath)
        }
      }
    }
    return tabs
  }

  private upsert(editor: vscode.TextEditor) {
    const rel = this.rel(editor.document.uri)
    if (!rel) {
      return
    }
    this.map.set(editor.document.uri.fsPath, {
      path: rel,
      active: editor.document.uri.fsPath === this.active,
      selection: this.selection(editor.selection),
    })
  }

  private rel(uri: vscode.Uri) {
    const folder = vscode.workspace.getWorkspaceFolder(uri)
    if (!folder) {
      return undefined
    }
    return vscode.workspace.asRelativePath(uri)
  }

  private selection(sel: vscode.Selection) {
    if (sel.isEmpty) {
      return undefined
    }
    return {
      startLine: Math.min(sel.anchor.line, sel.active.line) + 1,
      endLine: Math.max(sel.anchor.line, sel.active.line) + 1,
    }
  }
}

let files: Files
let sync: vscode.Disposable | undefined

export function activate(ctx: vscode.ExtensionContext) {
  files = new Files(ctx)

  ctx.subscriptions.push(
    output,
    vscode.commands.registerCommand("opencode.openNewTerminal", async () => {
      await open(ctx)
    }),
    vscode.commands.registerCommand("opencode.openTerminal", async () => {
      const existing = terminal()
      if (existing) {
        existing.show()
        return
      }
      await open(ctx)
    }),
    vscode.commands.registerCommand("opencode.syncContext", async () => {
      await push()
    }),
    vscode.commands.registerCommand("opencode.addFilepathToTerminal", async () => {
      const editor = vscode.window.activeTextEditor
      const term = terminal()
      if (!editor || !term) {
        return
      }

      const file = vscode.workspace.asRelativePath(editor.document.uri)
      const sel = editor.selection.isEmpty
        ? ""
        : `#L${Math.min(editor.selection.anchor.line, editor.selection.active.line) + 1}-${Math.max(editor.selection.anchor.line, editor.selection.active.line) + 1}`

      term.show()
      term.sendText(`@${file}${sel}`, false)
    }),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (!event.affectsConfiguration("opencode.context.autoSync")) {
        return
      }
      watch()
    }),
  )

  watch()
}

export function deactivate() {
  sync?.dispose()
}

function watch() {
  sync?.dispose()
  if (!cfg("context.autoSync", false)) {
    sync = undefined
    return
  }
  sync = files.onDidChange(() => {
    void push()
  })
}

function cfg<T extends boolean>(key: string, fallback: T) {
  return vscode.workspace.getConfiguration("opencode").get<T>(key, fallback)
}

function terminal() {
  return vscode.window.terminals.find((item) => item.name === TERMINAL_NAME)
}

function payload() {
  return files.snapshot(cfg("context.includeInactiveFiles", false))
}

function log(files: Item[], kind: string) {
  output.appendLine(
    `${kind}: ${files.map((file) => `${file.path}${file.selection ? `#L${file.selection.startLine}-${file.selection.endLine}` : ""}${file.active ? " [active]" : ""}`).join(", ") || "<none>"}`,
  )
}

async function push() {
  const term = terminal()
  if (!term) {
    return
  }
  const port = (term.creationOptions as { env?: Record<string, string> }).env?.["_EXTENSION_OPENCODE_PORT"]
  if (!port) {
    return
  }
  const body = payload()
  log(body, "sync")
  try {
    await fetch(`http://localhost:${port}/tui/context/sync`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ files: body }),
    })
  } catch (err) {
    output.appendLine(`sync error: ${String(err)}`)
  }
}

async function open(ctx: vscode.ExtensionContext) {
  const port = Math.floor(Math.random() * (65535 - 16384 + 1)) + 16384
  const body = payload()
  log(body, "open")

  const term = vscode.window.createTerminal({
    name: TERMINAL_NAME,
    iconPath: {
      light: vscode.Uri.file(path.join(ctx.extensionPath, "images", "button-dark.svg")),
      dark: vscode.Uri.file(path.join(ctx.extensionPath, "images", "button-light.svg")),
    },
    location: { viewColumn: vscode.ViewColumn.Beside, preserveFocus: false },
    env: {
      _EXTENSION_OPENCODE_PORT: String(port),
      OPENCODE_CALLER: "vscode",
      PATH: `/Users/ravshan/.local/bin:/usr/local/bin:/usr/bin:/bin:${process.env.PATH || ""}`,
    },
  })

  term.show()
  term.sendText(`${binary(ctx)} --port ${port}`)

  let tries = 10
  let ready = false
  while (tries > 0) {
    await new Promise((resolve) => setTimeout(resolve, 200))
    try {
      await fetch(`http://localhost:${port}/app`)
      ready = true
      break
    } catch {}
    tries -= 1
  }

  if (!ready) {
    return
  }

  try {
    await fetch(`http://localhost:${port}/tui/context/sync`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ files: body }),
    })
  } catch (err) {
    output.appendLine(`open error: ${String(err)}`)
  }
}

function binary(ctx: vscode.ExtensionContext) {
  const plat = process.platform
  const arch = process.arch
  const dir = `${plat === "darwin" ? "opencode-darwin" : plat === "linux" ? "opencode-linux" : "opencode-windows"}-${arch}`
  const exe = plat === "win32" ? "opencode.exe" : "opencode"
  const local = path.join(ctx.extensionPath, "..", "..", "packages", "opencode", "dist", dir, "bin", exe)
  if (existsSync(local)) {
    return local
  }
  return exe
}
