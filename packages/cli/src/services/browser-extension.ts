export * as BrowserExtension from "./browser-extension"

// The OpenCode Browser extension (packages/browser-extension) finds the background service
// through a Chrome native messaging host: `opencode browser host`. This module registers that host
// for installed Chromium browsers. The extension ships its own opencode plugin and hands it to the
// host, so the plugin always matches the installed extension version.
//
// Browser coverage follows ChatGPT's browser extension host (Chrome, Chrome for Testing, Chromium,
// Edge, Brave, Opera, Vivaldi on macOS, Linux, and Windows), plus Helium, Arc, and Chrome Beta/Canary.
import { Effect, FileSystem, Option, Schema } from "effect"
import { applyEdits, modify, parse } from "jsonc-parser"
import { homedir } from "node:os"
import path from "node:path"
import { Global } from "@opencode/util/global"
import { resolveConfigPath } from "../commands/handlers/mcp/add"

export const HOST_NAME = "ai.opencode.browser"
/** Extension IDs the host answers. The unpacked build's manifest key fixes its ID. */
/** The Chrome Web Store build, then the unpacked build (its ID is pinned by the manifest key). */
export const EXTENSION_IDS = ["mfnicocicmmlkpjnaffgihfjhdgjkdjg", "afeafocngkodbmaipcngoamamfmekgfo"]
/**
 * Chrome Web Store listing; set once the extension is published:
 * https://chromewebstore.google.com/detail/mfnicocicmmlkpjnaffgihfjhdgjkdjg
 */
export const STORE_URL: string | undefined = undefined
export const PLUGIN_FILE = "opencode-browser.ts"
/** Larger plugin sources are refused; the real one is a few kilobytes. */
export const PLUGIN_MAX_BYTES = 512 * 1024
/** Windows finds hosts through these per-user registry keys; other Chromium browsers read Chrome's. */
const REGISTRY_ROOTS = ["HKCU\\Software\\Google\\Chrome", "HKCU\\Software\\Microsoft\\Edge"]

/**
 * A browser is installed when its profile directory exists. On macOS and Linux its host manifests go in
 * each `manifests` directory; on Windows they are found through the registry instead.
 */
export type Browser = { name: string; bundleID?: string; profile: string; manifests: string[] }

export function browsers(): Browser[] {
  const home = homedir()
  if (process.platform === "darwin") {
    const support = (dir: string) => path.join(home, "Library/Application Support", dir)
    const browser = (name: string, bundleID: string, dirs: string[]): Browser => ({
      name,
      bundleID,
      profile: support(dirs[0]),
      manifests: dirs.map((dir) => path.join(support(dir), "NativeMessagingHosts")),
    })
    return [
      browser("Google Chrome", "com.google.Chrome", ["Google/Chrome"]),
      browser("Chrome for Testing", "com.google.chrome.for.testing", [
        "Google/Chrome for Testing",
        "Google/ChromeForTesting",
      ]),
      browser("Google Chrome Beta", "com.google.Chrome.beta", ["Google/Chrome Beta"]),
      browser("Google Chrome Canary", "com.google.Chrome.canary", ["Google/Chrome Canary"]),
      browser("Chromium", "org.chromium.Chromium", ["Chromium"]),
      browser("Microsoft Edge", "com.microsoft.edgemac", ["Microsoft Edge"]),
      browser("Brave", "com.brave.Browser", ["BraveSoftware/Brave-Browser"]),
      browser("Opera", "com.operasoftware.Opera", ["com.operasoftware.Opera"]),
      browser("Vivaldi", "com.vivaldi.Vivaldi", ["Vivaldi"]),
      browser("Helium", "net.imput.helium", ["net.imput.helium"]),
      browser("Arc", "company.thebrowser.Browser", ["Arc/User Data"]),
    ]
  }
  if (process.platform === "win32") {
    const local = process.env.LOCALAPPDATA ?? path.join(home, "AppData", "Local")
    const roaming = process.env.APPDATA ?? path.join(home, "AppData", "Roaming")
    return [
      { name: "Google Chrome", profile: path.join(local, "Google", "Chrome", "User Data"), manifests: [] },
      { name: "Microsoft Edge", profile: path.join(local, "Microsoft", "Edge", "User Data"), manifests: [] },
      { name: "Brave", profile: path.join(local, "BraveSoftware", "Brave-Browser", "User Data"), manifests: [] },
      { name: "Opera", profile: path.join(roaming, "Opera Software", "Opera Stable"), manifests: [] },
      { name: "Vivaldi", profile: path.join(local, "Vivaldi", "User Data"), manifests: [] },
    ]
  }
  const xdg = process.env.XDG_CONFIG_HOME ?? path.join(home, ".config")
  // Chrome-family builds honor CHROME_CONFIG_HOME before XDG_CONFIG_HOME.
  const chrome = process.env.CHROME_CONFIG_HOME ?? xdg
  const browser = (name: string, root: string, dir: string): Browser => ({
    name,
    profile: path.join(root, dir),
    manifests: [path.join(root, dir, "NativeMessagingHosts")],
  })
  return [
    browser("Google Chrome", chrome, "google-chrome"),
    browser("Google Chrome Beta", chrome, "google-chrome-beta"),
    browser("Google Chrome Unstable", chrome, "google-chrome-unstable"),
    browser("Chrome for Testing", chrome, "google-chrome-for-testing"),
    browser("Chromium", chrome, "chromium"),
    browser("Microsoft Edge", xdg, "microsoft-edge"),
    browser("Brave", xdg, "BraveSoftware/Brave-Browser"),
    browser("Opera", xdg, "opera"),
    browser("Vivaldi", xdg, "vivaldi"),
    browser("Helium", xdg, "net.imput.helium"),
  ]
}

export const paths = Effect.fnUntraced(function* () {
  const global = yield* Global.Service
  const directory = path.join(global.data, "browser-extension")
  return {
    /** Browsers start hosts without arguments we control, so a wrapper runs `opencode browser host`. */
    wrapper: path.join(directory, process.platform === "win32" ? "host.bat" : "host"),
    /** Windows reads the manifest from wherever its registry value points. */
    manifest: path.join(directory, `${HOST_NAME}.json`),
    plugin: path.join(global.config, "plugins", PLUGIN_FILE),
    /** Written by the host on each connection, for `status`. */
    state: path.join(global.state, "browser-extension.json"),
  }
})

/** Writes the wrapper and registers the host for every installed browser. Returns those browsers. */
export const install = Effect.fn("cli.browser.install")(function* () {
  const fs = yield* FileSystem.FileSystem
  const files = yield* paths()
  yield* fs.makeDirectory(path.dirname(files.wrapper), { recursive: true })
  yield* fs.writeFileString(files.wrapper, wrapper())
  if (process.platform !== "win32") yield* fs.chmod(files.wrapper, 0o755)
  const manifest =
    JSON.stringify(
      {
        name: HOST_NAME,
        description: "OpenCode Browser: finds the opencode background service",
        path: files.wrapper,
        type: "stdio",
        allowed_origins: EXTENSION_IDS.map((id) => `chrome-extension://${id}/`),
      },
      null,
      2,
    ) + "\n"
  const installed = yield* Effect.filter(browsers(), (browser) => fs.exists(browser.profile))
  if (process.platform === "win32") {
    yield* fs.writeFileString(files.manifest, manifest)
    REGISTRY_ROOTS.forEach((root) =>
      Bun.spawnSync(["reg", "add", registryKey(root), "/ve", "/t", "REG_SZ", "/d", files.manifest, "/f"]),
    )
    return installed
  }
  yield* Effect.forEach(
    installed.flatMap((browser) => browser.manifests),
    (directory) =>
      fs
        .makeDirectory(directory, { recursive: true })
        .pipe(Effect.andThen(fs.writeFileString(path.join(directory, `${HOST_NAME}.json`), manifest))),
  )
  return installed
})

/** Browsers the host is registered for. On Windows, every installed browser once the registry key exists. */
export const registered = Effect.fn("cli.browser.registered")(function* () {
  const fs = yield* FileSystem.FileSystem
  if (process.platform === "win32") {
    const exists = REGISTRY_ROOTS.some(
      (root) => Bun.spawnSync(["reg", "query", registryKey(root), "/ve"]).exitCode === 0,
    )
    return exists ? yield* Effect.filter(browsers(), (browser) => fs.exists(browser.profile)) : []
  }
  return yield* Effect.filter(browsers(), (browser) =>
    Effect.map(
      Effect.forEach(browser.manifests, (directory) => fs.exists(path.join(directory, `${HOST_NAME}.json`))),
      (found) => found.some(Boolean),
    ),
  )
})

/** Removes everything install and the host wrote. Returns the browsers it was registered for. */
export const uninstall = Effect.fn("cli.browser.uninstall")(function* () {
  const fs = yield* FileSystem.FileSystem
  const files = yield* paths()
  const removed = yield* registered()
  if (process.platform === "win32")
    REGISTRY_ROOTS.forEach((root) => Bun.spawnSync(["reg", "delete", registryKey(root), "/f"]))
  yield* Effect.forEach(
    browsers().flatMap((browser) => browser.manifests),
    (directory) => fs.remove(path.join(directory, `${HOST_NAME}.json`)).pipe(Effect.ignore),
  )
  yield* Effect.forEach([files.wrapper, files.manifest, files.plugin, files.state], (file) =>
    fs.remove(file).pipe(Effect.ignore),
  )
  return removed
})

/**
 * Opens the extension's store page in the default browser. On macOS, when the default is not one of the
 * installed Chromium browsers, the first installed one opens it. Returns where it opened, or undefined
 * when the extension is not published yet.
 */
export const openStore = Effect.fn("cli.browser.openStore")(function* (installed: Browser[]) {
  if (!STORE_URL) return undefined
  if (process.platform === "win32") {
    Bun.spawnSync(["cmd", "/c", "start", "", STORE_URL])
    return "your default browser"
  }
  if (process.platform !== "darwin") {
    Bun.spawnSync(["xdg-open", STORE_URL])
    return "your default browser"
  }
  const preferred = defaultBrowserID()
  const browser = installed.find((item) => item.bundleID?.toLowerCase() === preferred) ?? installed[0]
  Bun.spawnSync(["open", "-b", browser.bundleID!, STORE_URL])
  return browser.name
})

/** The MCP server name Browser Control uses in opencode's global config. */
export const BROWSER_CONTROL_MCP = "browser-control"

/**
 * Adds the Browser Control MCP server (Playwright-style browser automation through the same extension)
 * to opencode's global config, unless a server already runs browser-control. Returns what happened.
 */
export const configureBrowserControl = Effect.fn("cli.browser.configureBrowserControl")(function* () {
  const global = yield* Global.Service
  const fs = yield* FileSystem.FileSystem
  const file = yield* Effect.promise(() => resolveConfigPath(global.config))
  const text = yield* fs.readFileString(file).pipe(Effect.orElseSucceed(() => "{}"))
  // Lets a Browser Control relay that predates OpenCode Browser accept this extension's connection.
  const origins = EXTENSION_IDS.map((id) => `chrome-extension://${id}`).join(",")
  const existing = yield* browserControlConfigured()
  const servers = ((parse(text) ?? {}) as { mcp?: { servers?: Record<string, { environment?: Record<string, string> }> } })
    .mcp?.servers
  if (existing && servers?.[existing]?.environment?.BROWSER_CONTROL_EXTENSION_ORIGINS)
    return { status: "exists" as const, file, name: existing }
  const edits = existing
    ? modify(text, ["mcp", "servers", existing, "environment", "BROWSER_CONTROL_EXTENSION_ORIGINS"], origins, {
        formattingOptions: { tabSize: 2, insertSpaces: true },
      })
    : modify(
        text,
        ["mcp", "servers", BROWSER_CONTROL_MCP],
        {
          type: "local",
          command: Bun.which("browser-control")
            ? ["browser-control", "mcp"]
            : ["npx", "-y", "@opencode-ai/browser-control@latest", "mcp"],
          environment: { BROWSER_CONTROL_EXTENSION_ORIGINS: origins },
        },
        { formattingOptions: { tabSize: 2, insertSpaces: true } },
      )
  yield* fs.makeDirectory(path.dirname(file), { recursive: true })
  yield* fs.writeFileString(file, applyEdits(text, edits))
  return { status: existing ? ("updated" as const) : ("added" as const), file, name: existing ?? BROWSER_CONTROL_MCP }
})

export const browserControlConfigured = Effect.fn("cli.browser.browserControlConfigured")(function* () {
  const global = yield* Global.Service
  const fs = yield* FileSystem.FileSystem
  const file = yield* Effect.promise(() => resolveConfigPath(global.config))
  const config = (parse(yield* fs.readFileString(file).pipe(Effect.orElseSucceed(() => "{}"))) ?? {}) as {
    mcp?: { servers?: Record<string, { command?: unknown }> }
  }
  return Object.entries(config.mcp?.servers ?? {}).find(
    ([name, server]) => name === BROWSER_CONTROL_MCP || JSON.stringify(server.command ?? "").includes("browser-control"),
  )?.[0]
})

/** When the extension last reached the host, if ever. */
export const lastConnected = Effect.fn("cli.browser.lastConnected")(function* () {
  const fs = yield* FileSystem.FileSystem
  const files = yield* paths()
  const text = yield* fs.readFileString(files.state).pipe(Effect.orElseSucceed(() => ""))
  return Option.getOrUndefined(decodeState(text))?.connected
})

/**
 * The script browsers run. A release is a single binary. A development run executes the CLI source with
 * bun, which needs the CLI package directory as its working directory to pick up its bunfig.
 */
function wrapper() {
  const script = process.argv[1]?.endsWith(".ts") ? process.argv[1] : undefined
  const quote = (value: string) => `"${value}"`
  const command = [process.execPath, ...(script ? [script] : [])].map(quote).join(" ")
  const directory = script ? path.resolve(path.dirname(script), "..") : undefined
  if (process.platform === "win32")
    return `@echo off\r\n${directory ? `cd /d ${quote(directory)}\r\n` : ""}${command} browser host\r\n`
  return `#!/bin/sh\n${directory ? `cd ${quote(directory)} && ` : ""}exec ${command} browser host\n`
}

function registryKey(root: string) {
  return `${root}\\NativeMessagingHosts\\${HOST_NAME}`
}

/** The bundle identifier macOS opens https links with. */
function defaultBrowserID() {
  const result = Bun.spawnSync([
    "plutil",
    "-extract",
    "LSHandlers",
    "json",
    "-o",
    "-",
    path.join(homedir(), "Library/Preferences/com.apple.LaunchServices/com.apple.launchservices.secure.plist"),
  ])
  const handlers = Option.getOrUndefined(decodeHandlers(result.stdout.toString()))
  return handlers?.find((handler) => handler.LSHandlerURLScheme === "https")?.LSHandlerRoleAll?.toLowerCase()
}

const decodeHandlers = Schema.decodeUnknownOption(
  Schema.fromJsonString(
    Schema.Array(
      Schema.Struct({
        LSHandlerURLScheme: Schema.optional(Schema.String),
        LSHandlerRoleAll: Schema.optional(Schema.String),
      }),
    ),
  ),
)

const decodeState = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Struct({ connected: Schema.Finite })))
