import { execFile } from "node:child_process"
import { randomBytes } from "node:crypto"
import { readFile } from "node:fs/promises"
import { createServer } from "node:http"
import type { AddressInfo } from "node:net"
import { homedir } from "node:os"
import { extname, join, normalize, sep } from "node:path"
import { promisify } from "node:util"
import {
  commands,
  env,
  Uri,
  window,
  workspace,
  type Extension,
  type ExtensionContext,
  type Webview,
  type WebviewView,
  type WebviewViewProvider,
} from "vscode"
import {
  BOOTSTRAP_ELEMENT_ID,
  type Bootstrap,
  type Configuration,
  type HostMessage,
  type WebviewMessage,
} from "./webview-protocol"

export const SIDEBAR_VIEW_ID = "opencode.sidebar"

type Server = { url: string; password: string }

const OPEN_FOLDER = "workbench.action.files.openFolder"

/** The OpenCode app in a webview, connected to the shared background server. */
export function createSidebarProvider(context: ExtensionContext): WebviewViewProvider {
  const root = Uri.joinPath(context.extensionUri, "dist", "webview")

  return {
    async resolveWebviewView(view) {
      view.webview.options = { enableScripts: true, localResourceRoots: [root], enableCommandUris: [OPEN_FOLDER] }

      // In a remote window the extension runs on the remote, where the webview cannot reach the assets it serves.
      if (env.remoteName) {
        view.webview.html = noticeHtml("OpenCode does not work in remote windows yet. Open a local folder to use it.")
        return
      }

      // VS Code shows progress on the view while this resolves.
      const server = await startServer().catch((error: unknown) => {
        view.webview.html = errorHtml(error instanceof Error ? error.message : String(error))
        return undefined
      })

      if (!server) {
        return
      }

      const assets = await serveAssets(root.fsPath)

      // The app works in the window's first folder, its only project. Without one the view offers to open a folder, and
      // it reloads for another folder.
      const folder = () => workspace.workspaceFolders?.[0]?.uri.fsPath
      const render = async (directory: string | undefined) => {
        view.webview.html = directory
          ? await appHtml(view.webview, root, {
              server: new URL(server.url).origin,
              directory,
              version: context.extension.packageJSON.version,
              assets: assets.origin,
              configuration: readConfiguration(context.extension),
            })
          : noticeHtml("You have not yet opened a folder. OpenCode works in the folder open in this window.", {
              label: "Open Folder",
              command: OPEN_FOLDER,
            })
      }
      let rendered = folder()
      connect(view, server, context.extension, () => void render(rendered))
      const folders = workspace.onDidChangeWorkspaceFolders(() => {
        if (folder() === rendered) {
          return
        }
        rendered = folder()
        void render(rendered)
      })
      view.onDidDispose(() => {
        assets.close()
        folders.dispose()
      })
      await render(rendered)
    },
  }
}

/** Answers the webview's messages, and sends it the extension's settings whenever they change. */
function connect(view: WebviewView, server: Server, extension: Extension<unknown>, reload: () => void) {
  const requests = new Map<number, AbortController>()
  const origin = new URL(server.url).origin
  const authorization = server.password
    ? `Basic ${Buffer.from(`opencode:${server.password}`).toString("base64")}`
    : undefined
  const post = (message: HostMessage) => void view.webview.postMessage(message)

  view.webview.onDidReceiveMessage((message: WebviewMessage) => {
    if (message.type === "fetch") {
      return proxy(message)
    }
    if (message.type === "fetch.abort") {
      return requests.get(message.id)?.abort()
    }
    if (message.type === "open.external") {
      return openExternal(message.url)
    }
    if (message.type === "open.file") {
      return openFile(Uri.parse(message.url))
    }
    if (message.type === "open.path") {
      return openFile(Uri.file(message.path))
    }
    if (message.type === "notify") {
      return void window.showInformationMessage(
        message.description ? `${message.title}: ${message.description}` : message.title,
      )
    }
    if (message.type === "clipboard.write") {
      return void env.clipboard.writeText(message.text)
    }
    if (message.type === "settings.open") {
      return void commands.executeCommand("opencode.openSettings")
    }
    if (message.type === "reload") {
      return reload()
    }
  })

  const configuration = workspace.onDidChangeConfiguration((event) => {
    if (event.affectsConfiguration(SETTINGS) || event.affectsConfiguration("workbench.reduceMotion")) {
      post({ type: "configuration", configuration: readConfiguration(extension) })
    }
  })

  view.onDidDispose(() => {
    configuration.dispose()
    requests.forEach((request) => request.abort())
  })

  async function proxy(message: Extract<WebviewMessage, { type: "fetch" }>) {
    // The webview only proxies to the server; anything else it fetches itself.
    if (new URL(message.url).origin !== origin) {
      return post({ type: "fetch.error", id: message.id, message: "Only OpenCode server requests are proxied" })
    }

    const controller = new AbortController()
    requests.set(message.id, controller)
    const headers = new Headers(message.headers)
    if (authorization && !headers.has("authorization")) {
      headers.set("authorization", authorization)
    }

    await fetch(message.url, { method: message.method, headers, body: message.body, signal: controller.signal })
      .then(async (response) => {
        // fetch already decoded the body, so its encoding and length no longer describe what the webview receives.
        const forwarded = [...response.headers].filter(
          ([name]) => name !== "content-encoding" && name !== "content-length",
        )
        post({
          type: "fetch.head",
          id: message.id,
          status: response.status,
          statusText: response.statusText,
          headers: forwarded,
        })

        if (response.body) {
          for await (const chunk of response.body) {
            post({ type: "fetch.chunk", id: message.id, chunk })
          }
        }

        post({ type: "fetch.end", id: message.id })
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) {
          return
        }
        post({ type: "fetch.error", id: message.id, message: error instanceof Error ? error.message : String(error) })
      })
      .finally(() => requests.delete(message.id))
  }
}

const SETTINGS = "opencode"

type DeclaredSetting = { type: string; enum?: unknown[]; default: unknown }

/** Reads the extension's settings; a value that is not one `package.json` declares falls back to the default. */
function readConfiguration(extension: Extension<unknown>): Configuration {
  const config = workspace.getConfiguration(SETTINGS)
  const sections: { properties: Record<string, DeclaredSetting> }[] = extension.packageJSON.contributes.configuration
  const values = sections
    .flatMap((section) => Object.entries(section.properties))
    .map(([name, setting]) => {
      const key = name.slice(SETTINGS.length + 1)
      const value = config.get(key)
      const valid = setting.enum ? setting.enum.includes(value) : typeof value === setting.type
      return [key, valid ? value : setting.default]
    })
  const reduceMotion = workspace.getConfiguration("workbench").get("reduceMotion")

  return {
    ...Object.fromEntries(values),
    reduceMotion: reduceMotion === "on" || reduceMotion === "off" ? reduceMotion : "auto",
  } as Configuration
}

function openExternal(url: string) {
  const uri = Uri.parse(url)
  if (uri.scheme === "http" || uri.scheme === "https" || uri.scheme === "mailto") {
    void env.openExternal(uri)
  }
}

function openFile(uri: Uri) {
  if (uri.scheme === "file") {
    void commands.executeCommand("vscode.open", uri)
  }
}

async function appHtml(webview: Webview, root: Uri, bootstrap: Bootstrap) {
  const html = await readFile(Uri.joinPath(root, "index.html").fsPath, "utf8")
  const nonce = randomBytes(16).toString("base64")
  const source = webview.cspSource
  // Workers start from `data:` URLs and load their scripts from the loopback asset server.
  const csp = [
    "default-src 'none'",
    `script-src ${source} ${bootstrap.assets} 'nonce-${nonce}' 'wasm-unsafe-eval'`,
    `style-src ${source} 'unsafe-inline'`,
    `font-src ${source} data:`,
    `img-src ${source} https: data: blob:`,
    `media-src ${source} data: blob:`,
    `worker-src ${source} data: blob:`,
    `connect-src ${source} ${bootstrap.assets} https: data: blob:`,
    "frame-src blob:",
  ].join("; ")
  // `<` cannot end the JSON script element early once escaped.
  const data = JSON.stringify(bootstrap).replace(/</g, "\\u003c")

  return html
    .replace(/<script\b/g, `<script nonce="${nonce}"`)
    .replace(
      "<head>",
      [
        "<head>",
        `<base href="${webview.asWebviewUri(root)}/" />`,
        `<meta http-equiv="Content-Security-Policy" content="${csp}" />`,
        `<script id="${BOOTSTRAP_ELEMENT_ID}" type="application/json">${data}</script>`,
      ].join("\n"),
    )
}

const contentTypes: Record<string, string> = {
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".json": "application/json",
  ".wasm": "application/wasm",
  ".css": "text/css",
}

/** Serves the webview's files read-only on a loopback port, for workers to import. */
function serveAssets(dir: string) {
  const server = createServer((request, response) => {
    // The build's file names need no escapes, so the path is not decoded: decoding throws on a malformed escape, and
    // an escaped name matches no file. The URL parser has already resolved `..` segments, escaped ones included.
    const file = normalize(join(dir, new URL(request.url ?? "/", "http://localhost").pathname))
    if (request.method !== "GET" || !file.startsWith(dir + sep)) {
      response.writeHead(404).end()
      return
    }
    readFile(file).then(
      (body) =>
        response
          .writeHead(200, {
            "content-type": contentTypes[extname(file)] ?? "application/octet-stream",
            // Workers start from `data:` URLs, whose origin is opaque.
            "access-control-allow-origin": "*",
            "cache-control": "no-cache",
          })
          .end(body),
      () => response.writeHead(404).end(),
    )
  })

  return new Promise<{ origin: string; close(): void }>((resolve, reject) => {
    server.once("error", reject)
    server.listen(0, "127.0.0.1", () =>
      resolve({
        origin: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
        close: () => server.close(),
      }),
    )
  })
}

/**
 * A message in place of the app, styled like the Explorer's before a folder is open. Its action runs a VS Code command,
 * which the view must allow in `enableCommandUris`.
 */
function noticeHtml(text: string, action?: { label: string; command: string }) {
  return `<!doctype html>
<html>
  <head>
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'" />
    <style>
      body { padding: 0 20px; color: var(--vscode-foreground); font-family: var(--vscode-font-family); font-size: var(--vscode-font-size); }
      a { display: block; max-width: 300px; margin: 0 auto; padding: 4px; border-radius: 2px; text-align: center; text-decoration: none; color: var(--vscode-button-foreground); background: var(--vscode-button-background); }
      a:hover { background: var(--vscode-button-hoverBackground); }
    </style>
  </head>
  <body>
    <p>${text}</p>
    ${action ? `<a href="command:${action.command}">${action.label}</a>` : ""}
  </body>
</html>`
}

function errorHtml(message: string) {
  const escaped = message.replace(/[&<>"]/g, (char) => `&#${char.charCodeAt(0)};`)
  return `<!doctype html><html><body><p>Could not start the OpenCode server.</p><pre>${escaped}</pre></body></html>`
}

const run = promisify(execFile)

/** Finds or starts the background server, the same one the TUI and desktop app share. */
async function startServer(): Promise<Server> {
  return {
    url: await opencode(["service", "start"]),
    password: await opencode(["service", "get", "password"]),
  }
}

// An app launched from the Dock or Start menu does not inherit the shell PATH, so fall back to the installer location.
const binaries = ["opencode", join(homedir(), ".opencode", "bin", process.platform === "win32" ? "opencode.exe" : "opencode")]

async function opencode(args: string[]) {
  for (const binary of binaries) {
    const result = await run(binary, args, { env: { ...process.env, OPENCODE_CALLER: "vscode" } }).catch(
      (error: NodeJS.ErrnoException) => (error.code === "ENOENT" ? undefined : Promise.reject(error)),
    )
    if (result) {
      return result.stdout.trim()
    }
  }
  throw new Error("The `opencode` command was not found. Install OpenCode from https://opencode.ai.")
}
