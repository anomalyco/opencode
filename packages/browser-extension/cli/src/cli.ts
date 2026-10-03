#!/usr/bin/env node
// opencode-browser-cli: sets up the OpenCode Browser extension without changing opencode itself.
//   install    register the native messaging helper, add Browser Control to opencode's config, copy the extension
//   status     show what is set up
//   extension  open the bundled extension folder (for "Load unpacked")
//   uninstall  remove everything install wrote
//   host       the native messaging host the browser starts (not for people)
// The helper answers the extension with the URL and password of the user's own opencode service, found
// with `opencode service start` and `opencode service get password`, and installs the extension's plugin.
import { spawnSync } from "node:child_process"
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync, chmodSync } from "node:fs"
import { homedir } from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { applyEdits, modify, parse } from "jsonc-parser"

const HOST_NAME = "ai.opencode.browser"
/** The Chrome Web Store build, then the unpacked build (its ID is pinned by the manifest key). */
const EXTENSION_IDS = ["mfnicocicmmlkpjnaffgihfjhdgjkdjg", "afeafocngkodbmaipcngoamamfmekgfo"]
const PLUGIN_FILE = "opencode-browser.ts"
const PLUGIN_MAX_BYTES = 512 * 1024
const BROWSER_CONTROL_MCP = "browser-control"
const REGISTRY_ROOTS = ["HKCU\\Software\\Google\\Chrome", "HKCU\\Software\\Microsoft\\Edge"]
const windows = process.platform === "win32"

const home = homedir()
const dataRoot = windows
  ? (process.env.LOCALAPPDATA ?? path.join(home, "AppData", "Local"))
  : (process.env.XDG_DATA_HOME ?? path.join(home, ".local", "share"))
const configRoot = process.env.XDG_CONFIG_HOME ?? path.join(home, ".config")
const files = {
  dir: path.join(dataRoot, "opencode-browser"),
  cli: path.join(dataRoot, "opencode-browser", "cli.mjs"),
  wrapper: path.join(dataRoot, "opencode-browser", windows ? "host.bat" : "host"),
  manifest: path.join(dataRoot, "opencode-browser", `${HOST_NAME}.json`),
  settings: path.join(dataRoot, "opencode-browser", "settings.json"),
  state: path.join(dataRoot, "opencode-browser", "state.json"),
  extension: path.join(dataRoot, "opencode-browser", "extension"),
  plugin: path.join(configRoot, "opencode", "plugins", PLUGIN_FILE),
}
const self = fileURLToPath(import.meta.url)
const bundledExtension = path.join(path.dirname(self), "..", "extension")

type Browser = { name: string; bundleID?: string; profile: string; manifests: string[] }

function browsers(): Browser[] {
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
      browser("Chrome for Testing", "com.google.chrome.for.testing", ["Google/Chrome for Testing", "Google/ChromeForTesting"]),
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
  if (windows) {
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
  // Chrome-family builds honor CHROME_CONFIG_HOME before XDG_CONFIG_HOME.
  const chrome = process.env.CHROME_CONFIG_HOME ?? configRoot
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
    browser("Microsoft Edge", configRoot, "microsoft-edge"),
    browser("Brave", configRoot, "BraveSoftware/Brave-Browser"),
    browser("Opera", configRoot, "opera"),
    browser("Vivaldi", configRoot, "vivaldi"),
    browser("Helium", configRoot, "net.imput.helium"),
  ]
}

const installed = () => browsers().filter((browser) => existsSync(browser.profile))

function registered() {
  if (windows)
    return REGISTRY_ROOTS.some((root) => spawnSync("reg", ["query", registryKey(root), "/ve"]).status === 0)
      ? installed()
      : []
  return browsers().filter((browser) =>
    browser.manifests.some((directory) => existsSync(path.join(directory, `${HOST_NAME}.json`))),
  )
}

const registryKey = (root: string) => `${root}\\NativeMessagingHosts\\${HOST_NAME}`

/** The opencode binary to ask for the service: --opencode, $OPENCODE_BIN, or `opencode` on PATH. */
function findOpencode(args: string[]) {
  const flag = args.indexOf("--opencode")
  const explicit = flag === -1 ? process.env.OPENCODE_BIN : args[flag + 1]
  if (explicit) return path.resolve(explicit)
  const found = spawnSync(windows ? "where" : "which", ["opencode"], { encoding: "utf8" })
  return found.status === 0 ? found.stdout.split(/\r?\n/)[0].trim() : undefined
}

function readJson<T>(file: string): T | undefined {
  try {
    return JSON.parse(readFileSync(file, "utf8")) as T
  } catch {
    return undefined
  }
}

// ---- opencode config: the Browser Control MCP server ------------------------------------------------

function configFile() {
  const directory = path.join(configRoot, "opencode")
  const candidates = ["opencode.json", "opencode.jsonc", ".opencode/opencode.json", ".opencode/opencode.jsonc"].map(
    (name) => path.join(directory, name),
  )
  return candidates.find((file) => existsSync(file) && statSync(file).isFile()) ?? candidates[0]
}

type Servers = Record<string, { command?: unknown; environment?: Record<string, string> }>

function browserControlConfigured() {
  const config = (parse(readFileOr(configFile(), "{}")) ?? {}) as { mcp?: { servers?: Servers } }
  return Object.entries(config.mcp?.servers ?? {}).find(
    ([name, server]) => name === BROWSER_CONTROL_MCP || JSON.stringify(server.command ?? "").includes("browser-control"),
  )
}

/** Adds Browser Control to opencode's global config, or lets an existing entry accept this extension. */
function configureBrowserControl() {
  const file = configFile()
  const text = readFileOr(file, "{}")
  // Lets a Browser Control relay that predates OpenCode Browser accept this extension's connection.
  const origins = EXTENSION_IDS.map((id) => `chrome-extension://${id}`).join(",")
  const existing = browserControlConfigured()
  if (existing?.[1].environment?.BROWSER_CONTROL_EXTENSION_ORIGINS) return `already configured ("${existing[0]}")`
  const formattingOptions = { tabSize: 2, insertSpaces: true }
  const edits = existing
    ? modify(text, ["mcp", "servers", existing[0], "environment", "BROWSER_CONTROL_EXTENSION_ORIGINS"], origins, {
        formattingOptions,
      })
    : modify(
        text,
        ["mcp", "servers", BROWSER_CONTROL_MCP],
        {
          type: "local",
          command: spawnSync(windows ? "where" : "which", ["browser-control"]).status === 0
            ? ["browser-control", "mcp"]
            : ["npx", "-y", "@opencode-ai/browser-control@latest", "mcp"],
          environment: { BROWSER_CONTROL_EXTENSION_ORIGINS: origins },
        },
        { formattingOptions },
      )
  mkdirSync(path.dirname(file), { recursive: true })
  writeFileSync(file, applyEdits(text, edits))
  return existing ? `"${existing[0]}" now accepts OpenCode Browser` : `added to ${file}`
}

function readFileOr(file: string, fallback: string) {
  try {
    return readFileSync(file, "utf8")
  } catch {
    return fallback
  }
}

// ---- commands -------------------------------------------------------------------------------------

function install(args: string[]) {
  const opencode = findOpencode(args)
  if (!opencode) fail("Could not find opencode. Install it (https://opencode.ai) or pass --opencode <path>.")
  const browsersFound = installed()
  if (!browsersFound.length)
    fail("No supported browser found. Install Chrome, Edge, Brave, Opera, Vivaldi, Arc, or Helium, then run this again.")

  // npx runs from a cache that can be cleared, so the helper and the extension get a permanent home.
  mkdirSync(files.dir, { recursive: true })
  cpSync(self, files.cli)
  writeFileSync(files.settings, JSON.stringify({ opencode }, null, 2) + "\n")
  const quote = (value: string) => `"${value}"`
  writeFileSync(
    files.wrapper,
    windows
      ? `@echo off\r\n${quote(process.execPath)} ${quote(files.cli)} host\r\n`
      : `#!/bin/sh\nexec ${quote(process.execPath)} ${quote(files.cli)} host\n`,
  )
  if (!windows) chmodSync(files.wrapper, 0o755)
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
  if (windows) {
    writeFileSync(files.manifest, manifest)
    for (const root of REGISTRY_ROOTS)
      spawnSync("reg", ["add", registryKey(root), "/ve", "/t", "REG_SZ", "/d", files.manifest, "/f"])
  }
  if (!windows)
    for (const directory of browsersFound.flatMap((browser) => browser.manifests)) {
      mkdirSync(directory, { recursive: true })
      writeFileSync(path.join(directory, `${HOST_NAME}.json`), manifest)
    }
  log(`✓ Helper registered for ${browsersFound.map((browser) => browser.name).join(", ")}`)
  log(`✓ Using opencode at ${opencode}`)
  log(`✓ Browser Control MCP ${configureBrowserControl()}`)

  const service = startService(opencode)
  log(service.ok ? `✓ opencode service running at ${service.url}` : `! opencode service: ${service.error}`)

  if (existsSync(bundledExtension)) {
    rmSync(files.extension, { recursive: true, force: true })
    cpSync(bundledExtension, files.extension, { recursive: true })
    log("")
    log("Add the extension (until it's in the Chrome Web Store):")
    log("  1. Open chrome://extensions and turn on Developer mode")
    log("  2. Click Load unpacked and choose:")
    log(`     ${files.extension}`)
    log("  3. Click the OpenCode Browser toolbar icon to open the side panel")
    log("")
    log("Run `npx opencode-browser-cli extension` to open that folder.")
  }
}

function status(args: string[]) {
  const settings = readJson<{ opencode?: string }>(files.settings)
  const state = readJson<{ connected?: number }>(files.state)
  const found = registered()
  const control = browserControlConfigured()
  log(found.length ? `Helper:           registered for ${found.map((b) => b.name).join(", ")}` : "Helper:           not registered. Run `npx opencode-browser-cli install`.")
  log(`opencode:         ${settings?.opencode ?? findOpencode(args) ?? "not found"}`)
  log(state?.connected ? `Extension:        last connected ${new Date(state.connected).toLocaleString()}` : "Extension:        has not connected yet")
  log(control ? `Browser Control:  MCP server "${control[0]}" configured` : "Browser Control:  MCP server not configured")
  log(existsSync(files.extension) ? `Unpacked build:   ${files.extension}` : "Unpacked build:   not copied")
}

function extension() {
  if (!existsSync(files.extension)) {
    if (!existsSync(bundledExtension)) fail("This package has no bundled extension.")
    mkdirSync(files.dir, { recursive: true })
    cpSync(bundledExtension, files.extension, { recursive: true })
  }
  const opener = windows ? "explorer" : process.platform === "darwin" ? "open" : "xdg-open"
  spawnSync(opener, [files.extension])
  log(`Load unpacked from: ${files.extension}`)
}

function uninstall() {
  const found = registered()
  if (windows) for (const root of REGISTRY_ROOTS) spawnSync("reg", ["delete", registryKey(root), "/f"])
  for (const directory of browsers().flatMap((browser) => browser.manifests))
    rmSync(path.join(directory, `${HOST_NAME}.json`), { force: true })
  rmSync(files.plugin, { force: true })
  rmSync(files.dir, { recursive: true, force: true })
  log(found.length ? `✓ Removed the helper from ${found.map((b) => b.name).join(", ")}` : "✓ Nothing was registered")
  log("The Browser Control MCP entry in opencode's config was left in place. Remove the extension from your browser.")
}

// ---- native messaging host ------------------------------------------------------------------------

function startService(opencode: string): { ok: true; url: string; password: string } | { ok: false; error: string } {
  const run = (args: string[]) => {
    const result = spawnSync(opencode, args, { encoding: "utf8", timeout: 30_000, shell: windows })
    const output = (result.stdout ?? "").trim()
    return { ok: result.status === 0, output: output || (result.stderr ?? "").trim() }
  }
  const started = run(["service", "start"])
  if (!started.ok) return { ok: false, error: `Could not start opencode: ${started.output || "no output"}` }
  const line = started.output.split(/\r?\n/).findLast((item) => /^https?:\/\//.test(item.trim()))?.trim()
  if (!line) return { ok: false, error: `opencode did not report a service URL: ${started.output}` }
  const password = run(["service", "get", "password"])
  if (!password.ok || !password.output) return { ok: false, error: "Could not read the opencode service password." }
  const url = new URL(line)
  // A service bound to every interface is reached on loopback; browsers refuse to fetch 0.0.0.0.
  if (url.hostname === "0.0.0.0" || url.hostname === "[::]") url.hostname = "127.0.0.1"
  return { ok: true, url: url.origin, password: password.output }
}

// Chrome native messaging: a 4-byte little-endian length, then JSON, on stdin and stdout. Nothing else
// may go to stdout. Only the extension IDs in the host manifest can start this.
// - {type:"service"}: the service URL and password, starting the service if needed.
// - {type:"plugin", source}: installs the extension's opencode plugin when it changed.
async function host() {
  const settings = readJson<{ opencode?: string }>(files.settings)
  const respond = (message: unknown) => {
    if (typeof message !== "object" || message === null || !("type" in message)) return { ok: false, error: "Unknown request." }
    if (message.type === "plugin") {
      const source = "source" in message ? message.source : undefined
      if (typeof source !== "string" || !source || source.length > PLUGIN_MAX_BYTES) return { ok: false, error: "Invalid plugin source." }
      if (readFileOr(files.plugin, "") === source) return { ok: true, changed: false }
      mkdirSync(path.dirname(files.plugin), { recursive: true })
      writeFileSync(files.plugin, source)
      return { ok: true, changed: true }
    }
    if (message.type !== "service") return { ok: false, error: "Unknown request." }
    const opencode = settings?.opencode ?? findOpencode([])
    if (!opencode) return { ok: false, error: "opencode not found. Run `npx opencode-browser-cli install` again." }
    const service = startService(opencode)
    if (service.ok) writeFileSync(files.state, JSON.stringify({ connected: Date.now() }))
    return service
  }
  let buffer = Buffer.alloc(0)
  for await (const chunk of process.stdin) {
    buffer = Buffer.concat([buffer, chunk as Buffer])
    while (buffer.length >= 4) {
      const length = buffer.readUInt32LE(0)
      if (buffer.length < 4 + length) break
      const message = JSON.parse(buffer.subarray(4, 4 + length).toString("utf8"))
      buffer = buffer.subarray(4 + length)
      let reply: unknown
      try {
        reply = respond(message)
      } catch (error) {
        reply = { ok: false, error: String(error) }
      }
      const body = Buffer.from(JSON.stringify(reply))
      const header = Buffer.alloc(4)
      header.writeUInt32LE(body.length, 0)
      process.stdout.write(Buffer.concat([header, body]))
    }
  }
}

function log(line: string) {
  process.stdout.write(line + "\n")
}

function fail(message: string): never {
  process.stderr.write(message + "\n")
  process.exit(1)
}

const [command, ...args] = process.argv.slice(2)
if (command === "install") install(args)
else if (command === "status") status(args)
else if (command === "extension") extension()
else if (command === "uninstall") uninstall()
else if (command === "host") await host()
else
  log(`opencode-browser-cli: set up the OpenCode Browser extension

  npx opencode-browser-cli install [--opencode <path>]   register the helper, add Browser Control, copy the extension
  npx opencode-browser-cli status                        show what is set up
  npx opencode-browser-cli extension                     open the extension folder for "Load unpacked"
  npx opencode-browser-cli uninstall                     remove everything install wrote`)
