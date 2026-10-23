// Setup for OpenCode Browser, without changing opencode itself:
//   install    install the runtime, add the browse MCP server to opencode's config, copy the unpacked extension
//              (reloading a connected one), then check which browsers have the extension and open the Chrome Web
//              Store listing when none does
//   extension  open the unpacked extension folder (for "Load unpacked")
//   uninstall  remove everything install wrote
// Earlier versions registered a native messaging host and wrote an opencode plugin; install and uninstall
// remove those leftovers.
import { spawn, spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { applyEdits, modify, parse } from "jsonc-parser"
import { dataRoot } from "./paths.ts"
import { opencodeBrowserVersion } from "./version.ts"

const STORE_ID = "mfnicocicmmlkpjnaffgihfjhdgjkdjg"
/** The unpacked build; its ID is pinned by the manifest key. */
const UNPACKED_ID = "afeafocngkodbmaipcngoamamfmekgfo"
const STORE_URL = `https://chromewebstore.google.com/detail/${STORE_ID}`
const PACKAGE = "opencode-browser-cli"
const MCP_NAME = "browse"
/** The MCP server's name before it was renamed to `browse`. */
const LEGACY_MCP_NAME = "opencode-browser"
const LEGACY_HOST_NAME = "ai.opencode.browser"
const LEGACY_REGISTRY_ROOTS = ["HKCU\\Software\\Google\\Chrome", "HKCU\\Software\\Microsoft\\Edge"]
const windows = process.platform === "win32"

const home = homedir()
const root = dataRoot()
const configRoot = process.env.XDG_CONFIG_HOME ?? path.join(home, ".config")
const files = {
  dir: root,
  /** A pinned npm install of this package: the MCP server runs from here, not the npx cache. */
  runtime: path.join(root, "runtime"),
  settings: path.join(root, "settings.json"),
  extension: path.join(root, "extension"),
}
/** Files the native messaging host of earlier versions left behind. */
const legacyFiles = [
  path.join(root, "host"),
  path.join(root, "host.bat"),
  path.join(root, `${LEGACY_HOST_NAME}.json`),
  path.join(root, "state.json"),
  path.join(root, "logs", "host.log"),
  path.join(configRoot, "opencode", "plugins", "opencode-browser.ts"),
]
/** This package's root: dist/cli.mjs when published, src/setup.ts from source. */
const packageRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
/** Running from a source checkout without a package to install: the MCP server runs main.ts in place with bun. */
const fromSource = existsSync(path.join(packageRoot, "src", "main.ts")) && !process.env.OPENCODE_BROWSER_PACKAGE
const bundledExtension = path.join(packageRoot, "extension")

type Settings = { opencode?: string; entry?: string; version?: string }

type Browser = {
  name: string
  /** The Chromium user data directory: `Local State` and one directory per profile. */
  userData: string
  /** Where earlier versions wrote the native messaging host manifest. */
  manifests: string[]
  /** How the OS names this browser as the default: bundle IDs, desktop files, or URL ProgIds. */
  defaultIDs: string[]
  /** macOS application name, for `/Applications/<app>.app` and `open -a`. */
  app?: string
  /** Linux: binary names on PATH. Windows: full executable paths. */
  executables: string[]
}

function browsers(): Browser[] {
  if (process.platform === "darwin") {
    const support = (dir: string) => path.join(home, "Library/Application Support", dir)
    const browser = (name: string, app: string, bundleID: string, dirs: string[]): Browser => ({
      name,
      app,
      userData: support(dirs[0]!),
      manifests: dirs.map((dir) => path.join(support(dir), "NativeMessagingHosts")),
      defaultIDs: [bundleID],
      executables: [],
    })
    return [
      browser("Google Chrome", "Google Chrome", "com.google.Chrome", ["Google/Chrome"]),
      browser("Chrome for Testing", "Google Chrome for Testing", "com.google.chrome.for.testing", ["Google/Chrome for Testing", "Google/ChromeForTesting"]),
      browser("Google Chrome Beta", "Google Chrome Beta", "com.google.Chrome.beta", ["Google/Chrome Beta"]),
      browser("Google Chrome Canary", "Google Chrome Canary", "com.google.Chrome.canary", ["Google/Chrome Canary"]),
      browser("Chromium", "Chromium", "org.chromium.Chromium", ["Chromium"]),
      browser("Microsoft Edge", "Microsoft Edge", "com.microsoft.edgemac", ["Microsoft Edge"]),
      browser("Brave", "Brave Browser", "com.brave.Browser", ["BraveSoftware/Brave-Browser"]),
      browser("Opera", "Opera", "com.operasoftware.Opera", ["com.operasoftware.Opera"]),
      browser("Vivaldi", "Vivaldi", "com.vivaldi.Vivaldi", ["Vivaldi"]),
      browser("Helium", "Helium", "net.imput.helium", ["net.imput.helium"]),
      browser("Arc", "Arc", "company.thebrowser.Browser", ["Arc/User Data"]),
      browser("Dia", "Dia", "company.thebrowser.dia", ["Dia/User Data"]),
      browser("Comet", "Comet", "ai.perplexity.comet", ["Comet"]),
    ]
  }
  if (windows) {
    const local = process.env.LOCALAPPDATA ?? path.join(home, "AppData", "Local")
    const roaming = process.env.APPDATA ?? path.join(home, "AppData", "Roaming")
    const programs = [process.env.ProgramFiles, process.env["ProgramFiles(x86)"], local].filter((dir): dir is string => !!dir)
    const installs = (relative: string) => programs.map((dir) => path.join(dir, relative))
    return [
      { name: "Google Chrome", userData: path.join(local, "Google", "Chrome", "User Data"), manifests: [], defaultIDs: ["ChromeHTML"], executables: installs("Google\\Chrome\\Application\\chrome.exe") },
      { name: "Microsoft Edge", userData: path.join(local, "Microsoft", "Edge", "User Data"), manifests: [], defaultIDs: ["MSEdgeHTM"], executables: installs("Microsoft\\Edge\\Application\\msedge.exe") },
      { name: "Brave", userData: path.join(local, "BraveSoftware", "Brave-Browser", "User Data"), manifests: [], defaultIDs: ["BraveHTML"], executables: installs("BraveSoftware\\Brave-Browser\\Application\\brave.exe") },
      { name: "Opera", userData: path.join(roaming, "Opera Software", "Opera Stable"), manifests: [], defaultIDs: ["OperaStable"], executables: installs("Programs\\Opera\\opera.exe") },
      { name: "Vivaldi", userData: path.join(local, "Vivaldi", "User Data"), manifests: [], defaultIDs: ["VivaldiHTM"], executables: installs("Vivaldi\\Application\\vivaldi.exe") },
    ]
  }
  // Chrome-family builds honor CHROME_CONFIG_HOME before XDG_CONFIG_HOME.
  const chrome = process.env.CHROME_CONFIG_HOME ?? configRoot
  const browser = (name: string, root: string, dir: string, executables: string[]): Browser => ({
    name,
    userData: path.join(root, dir),
    manifests: [path.join(root, dir, "NativeMessagingHosts")],
    defaultIDs: executables,
    executables,
  })
  return [
    browser("Google Chrome", chrome, "google-chrome", ["google-chrome", "google-chrome-stable"]),
    browser("Google Chrome Beta", chrome, "google-chrome-beta", ["google-chrome-beta"]),
    browser("Google Chrome Unstable", chrome, "google-chrome-unstable", ["google-chrome-unstable"]),
    browser("Chrome for Testing", chrome, "google-chrome-for-testing", ["google-chrome-for-testing"]),
    browser("Chromium", chrome, "chromium", ["chromium", "chromium-browser"]),
    browser("Microsoft Edge", configRoot, "microsoft-edge", ["microsoft-edge", "microsoft-edge-stable"]),
    browser("Brave", configRoot, "BraveSoftware/Brave-Browser", ["brave-browser", "brave"]),
    browser("Opera", configRoot, "opera", ["opera"]),
    browser("Vivaldi", configRoot, "vivaldi", ["vivaldi", "vivaldi-stable"]),
    browser("Helium", configRoot, "net.imput.helium", ["helium", "helium-browser"]),
  ]
}

/** The opencode binary (recorded for status): --opencode, $OPENCODE_BIN, or `opencode` on PATH. */
function findOpencode(args: string[]) {
  const explicit = flag(args, "--opencode") ?? process.env.OPENCODE_BIN
  if (explicit) return path.resolve(explicit)
  return findOnPath("opencode")
}

function flag(args: string[], name: string) {
  const index = args.indexOf(name)
  return index === -1 ? undefined : args[index + 1]
}

function readJson<T>(file: string): T | undefined {
  try {
    return JSON.parse(readFileSync(file, "utf8")) as T
  } catch {
    return undefined
  }
}

// ---- opencode config: the browse MCP server ---------------------------------------------------------

function configFile() {
  const directory = path.join(configRoot, "opencode")
  const candidates = ["opencode.json", "opencode.jsonc", ".opencode/opencode.json", ".opencode/opencode.jsonc"].map(
    (name) => path.join(directory, name),
  )
  return candidates.find((file) => existsSync(file) && statSync(file).isFile()) ?? candidates[0]!
}

type Servers = Record<string, { type?: unknown; command?: unknown; environment?: unknown }>

/** Changes whenever the installed runtime does. */
function fingerprint(entry: string) {
  return createHash("sha256").update(readFileOr(entry, entry)).digest("hex").slice(0, 16)
}

/**
 * After an update, a relay still running the old build refuses the new CLI and MCP server; restart it from
 * the new runtime. Restarting keeps browser tabs open but ends in-flight agent work, so it's announced.
 */
function restartOutdatedRelay(entry: string, node: string) {
  const status = spawnSync(node, [entry, "status", "--json"], { encoding: "utf8", timeout: 15_000 })
  if (!/"stale":\s*true/.test(status.stdout ?? "")) return undefined
  const restart = spawnSync(node, [entry, "relay", "restart"], { encoding: "utf8", timeout: 60_000 })
  return restart.status === 0 ? "restarted with the new version" : `could not restart: ${(restart.stderr || restart.stdout).trim()}`
}

function mcpServers() {
  return ((parse(readFileOr(configFile(), "{}")) ?? {}) as { mcp?: { servers?: Servers } }).mcp?.servers ?? {}
}

/** Writes (or rewrites) the browse MCP server so it runs the installed runtime, replacing the old entry. */
function configureMcp(entry: string) {
  const file = configFile()
  // A running MCP server keeps its old code after an update, and its relay calls then fail on the build check.
  // Stamping the runtime's fingerprint into the entry changes the config whenever the runtime changes, which
  // makes opencode restart the server with the new code.
  const server = { type: "local", command: [process.execPath, entry, "mcp"], environment: { OPENCODE_BROWSER_RUNTIME: fingerprint(entry) } }
  const renamed = removeMcp(LEGACY_MCP_NAME)
  const existing = mcpServers()[MCP_NAME]
  if (existing && JSON.stringify(existing) === JSON.stringify(server)) return `"${MCP_NAME}" is up to date`
  const text = readFileOr(file, "{}")
  const edits = modify(text, ["mcp", "servers", MCP_NAME], server, { formattingOptions: { tabSize: 2, insertSpaces: true } })
  mkdirSync(path.dirname(file), { recursive: true })
  writeFileSync(file, applyEdits(text, edits))
  if (renamed) return `"${LEGACY_MCP_NAME}" renamed to "${MCP_NAME}" in ${file}`
  return existing ? `"${MCP_NAME}" updated in ${file}` : `"${MCP_NAME}" added to ${file}`
}

function removeMcp(name: string) {
  const file = configFile()
  const text = readFileOr(file, "")
  if (!text || !mcpServers()[name]) return false
  writeFileSync(file, applyEdits(text, modify(text, ["mcp", "servers", name], undefined, {})))
  return true
}

/** MCP servers from the separate Browser Control product, which OpenCode Browser replaces. */
function legacyBrowserControl() {
  return Object.entries(mcpServers())
    .filter(([name, server]) => name === "browser-control" || JSON.stringify(server.command ?? "").includes("browser-control"))
    .map(([name]) => name)
}

function readFileOr(file: string, fallback: string) {
  try {
    return readFileSync(file, "utf8")
  } catch {
    return fallback
  }
}

/** Removes the native messaging host and opencode plugin of earlier versions; true when any was there. */
function removeLegacyHost() {
  const leftovers = [
    ...browsers().flatMap((browser) => browser.manifests.map((directory) => path.join(directory, `${LEGACY_HOST_NAME}.json`))),
    ...legacyFiles,
  ].filter((file) => existsSync(file))
  leftovers.forEach((file) => rmSync(file, { force: true }))
  const keys = windows
    ? LEGACY_REGISTRY_ROOTS.map((root) => `${root}\\NativeMessagingHosts\\${LEGACY_HOST_NAME}`).filter(
        (key) => spawnSync("reg", ["query", key, "/ve"]).status === 0,
      )
    : []
  keys.forEach((key) => spawnSync("reg", ["delete", key, "/f"]))
  return leftovers.length + keys.length > 0
}

// ---- runtime ----------------------------------------------------------------------------------------

/**
 * Installs this exact version into the data root, so the MCP server keeps working after the npx cache is
 * cleared, and an update is one `install` away. From source (development), runs in place.
 * OPENCODE_BROWSER_PACKAGE installs a specific spec instead, for example a local tarball.
 */
function installRuntime() {
  if (fromSource) return path.join(packageRoot, "src", "main.ts")
  const spec = process.env.OPENCODE_BROWSER_PACKAGE ?? `${PACKAGE}@${opencodeBrowserVersion}`
  mkdirSync(files.runtime, { recursive: true })
  if (!existsSync(path.join(files.runtime, "package.json"))) writeFileSync(path.join(files.runtime, "package.json"), "{\"private\":true}\n")
  const npm = spawnSync(windows ? "npm.cmd" : "npm", ["install", "--prefix", files.runtime, "--no-audit", "--no-fund", "--loglevel=error", spec], {
    encoding: "utf8",
    shell: windows,
  })
  if (npm.status !== 0) fail(`Could not install ${spec}: ${(npm.stderr || npm.stdout || "npm failed").trim()}`)
  return path.join(files.runtime, "node_modules", PACKAGE, "dist", "cli.mjs")
}

// ---- commands -------------------------------------------------------------------------------------

async function install(args: string[]) {
  const opencode = findOpencode(args)

  mkdirSync(files.dir, { recursive: true })
  const entry = installRuntime()
  log(`✓ OpenCode Browser ${opencodeBrowserVersion} installed${fromSource ? " (from source)" : ""}`)
  writeFileSync(files.settings, JSON.stringify({ ...(opencode ? { opencode } : {}), entry, version: opencodeBrowserVersion } satisfies Settings, null, 2) + "\n")
  if (removeLegacyHost()) log("✓ Removed the native messaging host of an earlier version")

  const node = fromSource ? (findOnPath("bun") ?? process.execPath) : process.execPath
  log(opencode ? `✓ Using opencode at ${opencode}` : "! opencode not found. Install it (https://opencode.ai) to use the browse tools; they're configured for it.")
  log(`✓ MCP server ${configureMcp(entry)}`)
  const relay = restartOutdatedRelay(entry, node)
  if (relay) log(`${relay.startsWith("restarted") ? "✓" : "!"} Relay ${relay}`)
  const legacy = legacyBrowserControl()
  if (legacy.length)
    log(`! Browser Control MCP server${legacy.length === 1 ? "" : "s"} ${legacy.map((name) => `"${name}"`).join(", ")} also configured. OpenCode Browser replaces it; remove ${legacy.length === 1 ? "it" : "them"} from ${configFile()} to avoid two sets of browser tools.`)

  const connected = await connectedExtension()
  if (existsSync(bundledExtension)) {
    rmSync(files.extension, { recursive: true, force: true })
    cpSync(bundledExtension, files.extension, { recursive: true })
    // A browser already running an older unpacked build keeps its old code until it reloads; ask it to.
    const reload = connected ? await reloadOutdatedExtension(connected) : "current"
    if (reload === "reloaded") log("✓ Reloaded OpenCode Browser in your browser")
    if (reload === "stale")
      log("! OpenCode Browser didn't reload in your browser. Reload it on the browser's extensions page to finish the update.")
  }
  log("")
  locateExtension({ allowOpen: !args.includes("--no-open"), connected: !!connected })
}

/** Printed before the relay's status by `opencode-browser status`. */
export function printSetupStatus() {
  const settings = readJson<Settings>(files.settings)
  log(settings?.version ? `Setup:     installed` : "Setup:     not installed. Run `npx opencode-browser-cli install`.")
  log(`Version:   ${settings?.version ?? "not installed"}${settings?.entry ? ` (${settings.entry})` : ""}`)
  log(`opencode:  ${settings?.opencode ?? findOpencode([]) ?? "not found"}`)
  log(mcpServers()[MCP_NAME] ? `MCP:       "${MCP_NAME}" configured` : "MCP:       not configured")
  log(`Logs:      ${path.join(files.dir, "logs")}`)
  log("")
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
  const host = removeLegacyHost()
  const mcp = [MCP_NAME, LEGACY_MCP_NAME].filter((name) => removeMcp(name))
  rmSync(files.dir, { recursive: true, force: true })
  log(`✓ Removed ${files.dir}`)
  if (host) log("✓ Removed the native messaging host of an earlier version")
  if (mcp.length) log(`✓ Removed the ${mcp.map((name) => `"${name}"`).join(" and ")} MCP server${mcp.length === 1 ? "" : "s"}`)
  log("Remove the extension from your browser to finish.")
}

type ExtensionStatus = { connected?: boolean; build?: string | null; origin?: string | null }

const relayBase = () => `http://127.0.0.1:${Number(process.env.OPENCODE_BROWSER_PORT) || 19988}`

const extensionStatus = () =>
  fetch(`${relayBase()}/extension/status`, { signal: AbortSignal.timeout(3_000) })
    .then((response) => (response.ok ? (response.json() as Promise<ExtensionStatus>) : undefined))
    .catch(() => undefined)

/** The extension connected to the relay, if any; a relay restarted moments ago waits a second or two for it. */
async function connectedExtension() {
  let status = await extensionStatus()
  for (let attempt = 0; status?.connected === false && attempt < 10; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 500))
    status = await extensionStatus()
  }
  return status?.connected ? status : undefined
}

/**
 * Reloads the connected extension when it's the unpacked build (the store updates its own) and older than the files
 * just copied, then checks the reload took effect: the build it reports after reconnecting must be the new one.
 */
async function reloadOutdatedExtension(before: ExtensionStatus): Promise<"reloaded" | "stale" | "current"> {
  if (before.origin !== `chrome-extension://${UNPACKED_ID}`) return "current"
  const bundled = readJson<{ build?: string }>(path.join(files.extension, "build.json"))?.build
  if (bundled && before.build === bundled) return "current"
  const sent = await fetch(`${relayBase()}/extension/reload`, {
    method: "POST",
    body: "{}",
    headers: { "content-type": "application/json" },
    signal: AbortSignal.timeout(5_000),
  }).then(
    (response) => response.ok,
    () => false,
  )
  if (!sent) return "stale"
  for (let attempt = 0; attempt < 20; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 500))
    const after = await extensionStatus()
    if (after?.connected && after.build !== before.build) return "reloaded"
  }
  return "stale"
}

function findOnPath(name: string) {
  const found = spawnSync(windows ? "where" : "which", [name], { encoding: "utf8" })
  return found.status === 0 ? found.stdout.split(/\r?\n/)[0]?.trim() || undefined : undefined
}

// ---- which browsers have the extension -------------------------------------------------------------

type Profile = { dir: string; name: string }
type Match = { browser: Browser; profile: Profile; id: string }
/** blocked: the OS refused to read the browser's data (macOS privacy protection), so it may have the extension. */
type Detection = { browser: Browser; blocked: boolean; enabled: Match[]; disabled: Match[] }

/**
 * Reports the browsers and profiles that have OpenCode Browser. When none does (and none is connected to the relay),
 * opens its Chrome Web Store listing in the default browser, unless there is no browser to open here (SSH, no
 * display, no terminal, --no-open) or a browser couldn't be checked and may already have it.
 */
function locateExtension(options: { allowOpen: boolean; connected: boolean }) {
  const ready = "✓ Agents can use OpenCode Browser now. Click its toolbar button on a tab to let them use that tab too."
  // Over SSH the browsers here aren't the ones the user looks at.
  if (process.env.SSH_CONNECTION || process.env.SSH_TTY)
    return log(options.connected ? ready : `Install OpenCode Browser in your browser from the Chrome Web Store: ${STORE_URL}`)
  const detections = detectBrowsers()
  const preferred = defaultBrowser(detections.map((detection) => detection.browser))
  reportDetections(detections, preferred)
  // A connected extension is installed, even somewhere the scan doesn't look (a custom profile directory, a snap).
  if (options.connected || detections.some((detection) => detection.enabled.length))
    return log(ready)
  const off = detections.flatMap((detection) => detection.disabled)
  if (off.length)
    return log(`! OpenCode Browser is turned off in ${off.map((match) => `${match.browser.name} (${match.profile.name})`).join(", ")}. Turn it on in the browser's extensions page.`)
  const blocked = detections.filter((detection) => detection.blocked)
  const display = process.platform !== "linux" || !!(process.env.DISPLAY || process.env.WAYLAND_DISPLAY)
  const target = preferred ?? detections.find((detection) => !detection.blocked)?.browser
  const opened = options.allowOpen && display && !!process.stdout.isTTY && !blocked.length && target !== undefined
  if (opened) open(target, STORE_URL)
  log(`Install OpenCode Browser from the Chrome Web Store${opened ? ` (opened in ${target.name})` : ""}:`)
  log(`  ${STORE_URL}`)
  if (blocked.length) log(`  Already installed in ${blocked.map((detection) => detection.browser.name).join(", ")}? Then you're set.`)
  log(`  Or load the unpacked build: npx ${PACKAGE} extension`)
}

/** Every browser with user data here, and the profiles that have OpenCode Browser. */
function detectBrowsers() {
  return browsers().flatMap((browser): Detection[] => {
    const state = readLocked(path.join(browser.userData, "Local State"))
    if (state.missing) return []
    // Leftover data of an uninstalled browser: nothing to open it with.
    if (state.blocked) return launcher(browser) ? [{ browser, blocked: true, enabled: [], disabled: [] }] : []
    const matches = listProfiles(browser, state.text).flatMap((profile) => {
      const settings = ["Secure Preferences", "Preferences"].map(
        (file) =>
          (parseJson(readLocked(path.join(browser.userData, profile.dir, file)).text) as { extensions?: { settings?: Record<string, ExtensionSetting> } } | undefined)
            ?.extensions?.settings ?? {},
      )
      const id = [STORE_ID, UNPACKED_ID].find((candidate) => settings.some((entries) => entries[candidate]))
      if (!id) return []
      const setting = settings.find((entries) => entries[id])![id]!
      return [{ browser, profile, id, enabled: !disabled(setting) }]
    })
    return [
      {
        browser,
        blocked: false,
        enabled: matches.filter((match) => match.enabled),
        disabled: matches.filter((match) => !match.enabled),
      },
    ]
  })
}

type ExtensionSetting = { disable_reasons?: unknown }

function disabled(setting: ExtensionSetting) {
  const reasons = setting.disable_reasons
  if (Array.isArray(reasons)) return reasons.length > 0
  return typeof reasons === "number" && reasons !== 0
}

/** Profiles from `Local State` (with their display names), else the profile directories themselves. */
function listProfiles(browser: Browser, localState: string | undefined): Profile[] {
  const cache = (parseJson(localState) as { profile?: { info_cache?: Record<string, { name?: string }> } } | undefined)?.profile?.info_cache
  if (cache && Object.keys(cache).length)
    return Object.entries(cache).map(([dir, info]) => ({ dir, name: info.name || dir }))
  const dirs = (() => {
    try {
      return readdirSync(browser.userData)
    } catch {
      return []
    }
  })()
  return dirs.filter((dir) => /^(Default|Profile \d+)$/.test(dir)).map((dir) => ({ dir, name: dir }))
}

function readLocked(file: string) {
  try {
    return { text: readFileSync(file, "utf8"), missing: false, blocked: false }
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    return { text: undefined, missing: code === "ENOENT" || code === "ENOTDIR", blocked: code === "EPERM" || code === "EACCES" }
  }
}

function parseJson(text: string | undefined): unknown {
  if (!text) return undefined
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

/** The OS default web browser among the known ones; undefined when it can't be told or isn't Chromium. */
function defaultBrowser(candidates: Browser[]) {
  const id = defaultBrowserID()
  if (!id) return undefined
  const known = browsers().find((browser) =>
    browser.defaultIDs.some((name) => name.toLowerCase() === id.toLowerCase() || id.startsWith(`${name}.`)),
  )
  return known && (candidates.find((browser) => browser.name === known.name) ?? known)
}

function defaultBrowserID() {
  if (process.platform === "darwin") {
    const plist = path.join(home, "Library/Preferences/com.apple.LaunchServices/com.apple.launchservices.secure.plist")
    const json = spawnSync("plutil", ["-convert", "json", "-o", "-", plist], { encoding: "utf8" })
    const handlers =
      (parseJson(json.stdout) as { LSHandlers?: { LSHandlerURLScheme?: string; LSHandlerRoleAll?: string }[] } | undefined)?.LSHandlers ?? []
    return ["https", "http"]
      .map((scheme) => handlers.find((handler) => handler.LSHandlerURLScheme === scheme)?.LSHandlerRoleAll)
      .find((bundle) => !!bundle)
  }
  if (windows) {
    const key = "HKCU\\Software\\Microsoft\\Windows\\Shell\\Associations\\UrlAssociations\\https\\UserChoice"
    const query = spawnSync("reg", ["query", key, "/v", "ProgId"], { encoding: "utf8" })
    return /ProgId\s+REG_SZ\s+(\S+)/.exec(query.stdout ?? "")?.[1]
  }
  const xdg = spawnSync("xdg-settings", ["get", "default-web-browser"], { encoding: "utf8" })
  return xdg.status === 0 ? xdg.stdout.trim().replace(/\.desktop$/, "") || undefined : undefined
}

function reportDetections(detections: Detection[], preferred: Browser | undefined) {
  log(`Default browser: ${preferred?.name ?? "unknown"}`)
  detections.forEach((detection) => {
    const name = detection.browser.name
    if (detection.blocked) return log(`  ${name}: couldn't check (${blockedReason()})`)
    if (detection.enabled.length) return log(`  ${name}: OpenCode Browser in ${detection.enabled.map(describe).join(", ")}`)
    if (detection.disabled.length) return log(`  ${name}: OpenCode Browser turned off in ${detection.disabled.map(describe).join(", ")}`)
    log(`  ${name}: no OpenCode Browser`)
  })
}

const describe = (match: Match) => `${match.profile.name}${match.id === UNPACKED_ID ? " (unpacked)" : ""}`
const blockedReason = () => (process.platform === "darwin" ? "macOS privacy protection" : "permission denied")

/** Opens a URL in a specific browser; launching its executable forwards the URL to a running instance. */
function open(browser: Browser, url: string) {
  const executable = launcher(browser)?.executable
  if (executable) {
    const child = spawn(executable, [url], { detached: true, stdio: "ignore" })
    child.on("error", () => openWithSystem(browser, url))
    child.unref()
    return
  }
  openWithSystem(browser, url)
}

function openWithSystem(browser: Browser, url: string) {
  if (process.platform === "darwin") return void spawnSync("open", browser.app ? ["-a", browser.app, url] : [url])
  // rundll32 hands the URL to its handler without cmd parsing the & in it.
  if (windows) return void spawnSync("rundll32", ["url.dll,FileProtocolHandler", url])
  spawnSync("xdg-open", [url])
}

/** The browser's executable, or (macOS) just its app bundle when the executable can't be read. */
function launcher(browser: Browser): { executable?: string } | undefined {
  if (process.platform === "darwin") {
    const bundle = [path.join("/Applications", `${browser.app}.app`), path.join(home, "Applications", `${browser.app}.app`)].find((dir) => existsSync(dir))
    if (!bundle) return undefined
    const name = spawnSync("plutil", ["-extract", "CFBundleExecutable", "raw", "-o", "-", path.join(bundle, "Contents", "Info.plist")], { encoding: "utf8" }).stdout?.trim()
    const executable = name ? path.join(bundle, "Contents", "MacOS", name) : undefined
    return executable && existsSync(executable) ? { executable } : {}
  }
  const executable = windows ? browser.executables.find((file) => existsSync(file)) : browser.executables.map(findOnPath).find((file) => !!file)
  return executable ? { executable } : undefined
}

function log(line: string) {
  process.stdout.write(line + "\n")
}

function fail(message: string): never {
  process.stderr.write(message + "\n")
  process.exit(1)
}

export async function runSetup(command: string, args: string[]) {
  if (command === "install") return install(args)
  if (command === "extension") return extension()
  if (command === "uninstall") return uninstall()
}
