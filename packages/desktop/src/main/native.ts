import { execFile } from "node:child_process"
import { constants as fsConstants } from "node:fs"
import {
  access,
  chmod,
  copyFile,
  mkdir,
  readFile,
  readdir,
  stat,
  writeFile,
} from "node:fs/promises"
import { homedir } from "node:os"
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path"
import { promisify } from "node:util"
import { app, shell } from "electron"
import {
  CUSTOM_EDITOR_PATH_KEY,
  DEFAULT_EDITOR_KEY,
  GENERICAGENT_CONFIG_KEY,
  HERMES_CONFIG_KEY,
  OPENCLAW_CONFIG_KEY,
} from "./constants"
import { getStore } from "./store"
import type {
  ConfigFile,
  ConfigTreeItem,
  ConfigWorkspace,
  GenericagentConfig,
  GenericagentTest,
  HermesConfig,
  HermesTest,
  OpenclawConfig,
  OpenclawDetection,
  OpenclawTest,
  TrellisTask,
  TrellisTaskList,
} from "../preload/types"
import { resolveDesktopPath } from "./native-path"

const execFileAsync = promisify(execFile)
const TEXT_FILE_LIMIT = 2 * 1024 * 1024
const DEFAULT_OPENCLAW_GATEWAY_URL = "ws://127.0.0.1:18789"
const allowedRoots = new Set<string>()

type OpenEditor = {
  macos?: string
  command: string
  args: (path: string) => string[]
}

const editors: Record<string, OpenEditor> = {
  vscode: { macos: "Visual Studio Code", command: "code", args: (path) => [path] },
  code: { macos: "Visual Studio Code", command: "code", args: (path) => [path] },
  cursor: { macos: "Cursor", command: "cursor", args: (path) => [path] },
  sublime: { macos: "Sublime Text", command: "subl", args: (path) => [path] },
  "sublime-text": { macos: "Sublime Text", command: "subl", args: (path) => [path] },
  zed: { macos: "Zed", command: "zed", args: (path) => [path] },
  textmate: { macos: "TextMate", command: "mate", args: (path) => [path] },
  antigravity: { macos: "Antigravity", command: "antigravity", args: (path) => [path] },
  xcode: { macos: "Xcode", command: "xed", args: (path) => [path] },
  "android-studio": { macos: "Android Studio", command: "studio", args: (path) => [path] },
  wezterm: { macos: "WezTerm", command: "wezterm", args: (path) => ["start", "--cwd", path] },
  ghostty: { macos: "Ghostty", command: "ghostty", args: (path) => ["--working-directory", path] },
}

export function registerAllowedRoot(path: string | null | undefined) {
  if (!path) return
  const resolved = resolveDesktopPath(path)
  allowedRoots.add(resolved)
}

export function getConfigRoot() {
  if (process.env.OPENCODE_CONFIG_DIR) return resolveDesktopPath(process.env.OPENCODE_CONFIG_DIR)
  const xdg = process.env.XDG_CONFIG_HOME
  if (xdg) return resolveDesktopPath(join(xdg, "opencode"))
  return resolve(homedir(), ".config", "opencode")
}

export async function installCli() {
  const source = await bundledCliPath()
  const targetDir = process.platform === "win32" ? join(homedir(), "AppData", "Local", "opencode", "bin") : join(homedir(), ".local", "bin")
  const target = join(targetDir, process.platform === "win32" ? "opencode.exe" : "opencode")
  await mkdir(targetDir, { recursive: true })
  await copyFile(source, target)
  if (process.platform !== "win32") await chmod(target, 0o755)
  return target
}

export async function openInFinder(path: string) {
  const target = resolveDesktopPath(path)
  const info = await stat(target).catch(() => undefined)
  if (process.platform === "darwin") {
    if (info?.isDirectory()) {
      const result = await shell.openPath(target)
      if (result) throw new Error(result)
      return
    }
    shell.showItemInFolder(target)
    return
  }
  const result = await shell.openPath(info?.isDirectory() ? target : dirname(target))
  if (result) throw new Error(result)
}

export async function openInEditor(editor: string, path: string) {
  const target = resolveDesktopPath(path)
  const custom = getStore().get(CUSTOM_EDITOR_PATH_KEY)
  if (editor === "custom" && typeof custom === "string" && custom.trim()) {
    await execFileAsync(custom, [target])
    return
  }

  const key = editor.toLowerCase()
  const entry = editors[key] ?? { command: editor, args: (input: string) => [input] }
  if (process.platform === "darwin" && entry.macos) {
    await execFileAsync("open", ["-a", entry.macos, target])
    return
  }
  await execFileAsync(entry.command, entry.args(target))
}

export function getCustomEditorPath() {
  const value = getStore().get(CUSTOM_EDITOR_PATH_KEY)
  return typeof value === "string" ? value : null
}

export function setCustomEditorPath(path: string | null) {
  if (path?.trim()) getStore().set(CUSTOM_EDITOR_PATH_KEY, path)
  else getStore().delete(CUSTOM_EDITOR_PATH_KEY)
}

export function getDefaultEditor() {
  const value = getStore().get(DEFAULT_EDITOR_KEY)
  return typeof value === "string" ? value : null
}

export function setDefaultEditor(editor: string | null) {
  if (editor?.trim()) getStore().set(DEFAULT_EDITOR_KEY, editor)
  else getStore().delete(DEFAULT_EDITOR_KEY)
}

export async function filterDirectories(paths: string[]) {
  const result: string[] = []
  for (const path of paths) {
    const resolved = resolveDesktopPath(path)
    const info = await stat(resolved).catch(() => undefined)
    if (info?.isDirectory()) {
      registerAllowedRoot(resolved)
      result.push(resolved)
    }
  }
  return result
}

export async function listLocalDirectory(path: string) {
  const root = resolveDesktopPath(path)
  registerAllowedRoot(root)
  registerAllowedRoot(dirname(root))
  const entries = await readdir(root, { withFileTypes: true }).catch(() => [])
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => ({
      path: join(root, entry.name),
      kind: "directory" as const,
    }))
}

export async function listConfigFiles(directory?: string | null): Promise<ConfigFile[]> {
  const files: ConfigFile[] = []
  const configRoot = getConfigRoot()
  registerAllowedRoot(configRoot)
  for (const ext of ["jsonc", "json"]) {
    files.push(await configFile(`global-opencode-${ext}`, `opencode.${ext}`, join(configRoot, `opencode.${ext}`), "global", "config"))
  }
  files.push(await configFile("global-agents-md", "AGENTS.md", join(configRoot, "AGENTS.md"), "global", "agents"))

  if (directory) {
    const root = resolve(directory)
    registerAllowedRoot(root)
    registerAllowedRoot(join(root, ".opencode"))
    for (const ext of ["jsonc", "json"]) {
      files.push(await configFile(`project-opencode-${ext}`, `opencode.${ext}`, join(root, `opencode.${ext}`), "project", "config"))
      files.push(
        await configFile(
          `project-dir-opencode-${ext}`,
          `.opencode/opencode.${ext}`,
          join(root, ".opencode", `opencode.${ext}`),
          "project",
          "config",
        ),
      )
    }
  }
  return files
}

export async function getConfigWorkspace(): Promise<ConfigWorkspace> {
  const configRoot = getConfigRoot()
  registerAllowedRoot(configRoot)
  const agents = await collectWorkspaceFiles([join(configRoot, "agent"), join(configRoot, "agents")], [".md", ".mdx"])
  const plugins = await collectWorkspaceFiles([join(configRoot, "plugin"), join(configRoot, "plugins")], [
    ".ts",
    ".js",
    ".mjs",
    ".cjs",
    ".mts",
    ".cts",
  ])
  return {
    configRoot,
    agentsRoot: join(configRoot, "agents"),
    skillsRoot: join(configRoot, "skills"),
    pluginsRoot: join(configRoot, "plugins"),
    agentsMdPath: join(configRoot, "AGENTS.md"),
    agents,
    plugins,
  }
}

export async function listConfigDirectory(path: string): Promise<ConfigTreeItem[]> {
  const root = assertAllowedLocalPath(path)
  const entries = await readdir(root, { withFileTypes: true }).catch(() => [])
  return entries.map((entry) => ({
    path: join(root, entry.name),
    kind: entry.isDirectory() ? ("directory" as const) : ("file" as const),
  }))
}

export async function readConfigFile(path: string) {
  const target = assertAllowedLocalPath(path)
  const info = await stat(target).catch(() => undefined)
  if (!info?.isFile()) return null
  if (info.size > TEXT_FILE_LIMIT) throw new Error(`File is too large to read: ${target}`)
  return readFile(target, "utf8")
}

export async function writeConfigFile(path: string, content: string) {
  const target = assertAllowedLocalPath(path)
  await mkdir(dirname(target), { recursive: true })
  await writeFile(target, content, "utf8")
}

export async function createConfigFile(path: string, content: string) {
  const target = assertAllowedLocalPath(path)
  await mkdir(dirname(target), { recursive: true })
  await writeFile(target, content, { encoding: "utf8", flag: "wx" })
}

export async function listTrellisTasks(directory: string): Promise<TrellisTaskList> {
  const root = resolve(directory)
  registerAllowedRoot(root)
  const tasks: TrellisTask[] = []
  let skipped = 0
  const worktrees = await listGitWorktrees(root)
  const roots = worktrees.length > 0 ? worktrees : [root]
  let current: string | undefined
  for (const worktreeRoot of roots) {
    const result = await listTrellisTasksInWorktree(worktreeRoot)
    if (worktreeRoot === root) current = result.current
    skipped += result.skipped
    tasks.push(...result.tasks)
  }
  return { root, current, skipped, tasks }
}

async function listGitWorktrees(root: string) {
  const result = await execFileAsync("git", ["-C", root, "worktree", "list", "--porcelain"], {
    timeout: 3000,
    windowsHide: true,
  }).catch(() => undefined)
  if (!result?.stdout) return []
  const roots: string[] = []
  for (const line of result.stdout.split(/\r?\n/)) {
    if (!line.startsWith("worktree ")) continue
    const worktreeRoot = resolve(line.slice("worktree ".length).trim())
    if (worktreeRoot) roots.push(worktreeRoot)
  }
  return Array.from(new Set(roots))
}

async function listTrellisTasksInWorktree(worktreeRoot: string): Promise<{
  current?: string
  skipped: number
  tasks: TrellisTask[]
}> {
  registerAllowedRoot(worktreeRoot)
  const trellisRoot = join(worktreeRoot, ".trellis")
  registerAllowedRoot(trellisRoot)
  const tasksRoot = join(trellisRoot, "tasks")
  const current = await readFile(join(trellisRoot, ".current-task"), "utf8")
    .then((value) => value.trim())
    .catch(() => undefined)
  const folders = await readdir(tasksRoot, { withFileTypes: true }).catch(() => [])
  const tasks: TrellisTask[] = []
  let skipped = 0
  for (const entry of folders) {
    if (!entry.isDirectory() || entry.name === "archive") continue
    const path = join(tasksRoot, entry.name)
    const raw = await readFile(join(path, "task.json"), "utf8").catch(() => undefined)
    if (!raw) {
      skipped++
      continue
    }
    try {
      const data = JSON.parse(raw) as Partial<TrellisTask> & { id?: string; name?: string }
      const id = data.id ?? entry.name
      const name = data.name ?? id
      tasks.push({
        id: `${worktreeRoot}:${id}`,
        name,
        title: typeof data.title === "string" ? data.title : name,
        status: typeof data.status === "string" ? data.status : "unknown",
        priority: stringOrUndefined(data.priority),
        assignee: stringOrUndefined(data.assignee),
        package: stringOrUndefined(data.package),
        parent: stringOrUndefined(data.parent),
        children: Array.isArray(data.children) ? data.children.filter((value): value is string => typeof value === "string") : [],
        createdAt: stringOrUndefined(data.createdAt),
        completedAt: stringOrUndefined(data.completedAt),
        path,
        worktreeRoot,
        worktreeName: basename(worktreeRoot),
        current: Boolean(current && (current === path || current === entry.name || current.endsWith(`/${entry.name}`))),
      })
    } catch {
      skipped++
    }
  }
  return { current, skipped, tasks }
}

export function getOpenclawConfig(): OpenclawConfig {
  return parseStoreObject<OpenclawConfig>(OPENCLAW_CONFIG_KEY, { enabled: false })
}

export function setOpenclawConfig(config: OpenclawConfig) {
  getStore().set(OPENCLAW_CONFIG_KEY, config)
}

export async function detectOpenclawConfig(): Promise<OpenclawDetection> {
  const logs: string[] = []
  const found: Array<{ config: OpenclawConfig; source: string; score: number }> = []
  const env = detectOpenclawFromEnv()
  if (env) {
    logs.push("Found OpenClaw gateway settings in environment variables.")
    found.push({ config: withDefaultOpenclawUrl(env), source: "environment", score: 100 })
  }

  for (const file of openclawConfigPaths()) {
    const config = await detectOpenclawFromFile(file)
    if (!config) continue
    logs.push(`Found OpenClaw gateway settings in ${file}.`)
    found.push({ config: withDefaultOpenclawUrl(config), source: file, score: 80 })
  }

  const command = await detectOpenclawFromCommand()
  if (command) {
    logs.push(`Found OpenClaw gateway settings from ${command.source}.`)
    found.push({ config: withDefaultOpenclawUrl(command.config), source: command.source, score: 90 })
  }

  found.push({ config: { enabled: true, url: DEFAULT_OPENCLAW_GATEWAY_URL }, source: "default local gateway", score: 10 })
  logs.push(`Added default OpenClaw gateway candidate ${DEFAULT_OPENCLAW_GATEWAY_URL}.`)

  const best = found
    .filter((item) => !!item.config.url?.trim())
    .sort((a, b) => b.score - a.score)[0]
  if (!best) {
    return { ok: false, logs: [...logs, "No OpenClaw gateway URL was detected."] }
  }
  return { ok: true, config: best.config, source: best.source, logs }
}

export function getGenericagentConfig(): GenericagentConfig {
  return parseStoreObject<GenericagentConfig>(GENERICAGENT_CONFIG_KEY, { enabled: false })
}

export function setGenericagentConfig(config: GenericagentConfig) {
  getStore().set(GENERICAGENT_CONFIG_KEY, config)
}

export function getHermesConfig(): HermesConfig {
  return parseStoreObject<HermesConfig>(HERMES_CONFIG_KEY, { enabled: false })
}

export function setHermesConfig(config: HermesConfig) {
  getStore().set(HERMES_CONFIG_KEY, config)
}

export async function bundledCliPath() {
  const candidates = [
    join(process.resourcesPath, "sidecars", cliName()),
    join(app.getAppPath(), "resources", "sidecars", cliName()),
    join(app.getAppPath(), "src-tauri", "sidecars", cliName()),
    join(process.cwd(), "src-tauri", "sidecars", cliName()),
    join(process.cwd(), "resources", "sidecars", cliName()),
    join(process.cwd(), "..", "opencode", "dist", distName(), "bin", process.platform === "win32" ? "opencode.exe" : "opencode"),
  ]
  for (const candidate of candidates) {
    if (await exists(candidate)) return candidate
  }
  throw new Error("Bundled opencode CLI was not found")
}

function cliName() {
  const suffix = nativeTarget()
  return process.platform === "win32" ? `opencode-cli-${suffix}.exe` : `opencode-cli-${suffix}`
}

function nativeTarget() {
  if (process.platform === "darwin") return process.arch === "arm64" ? "aarch64-apple-darwin" : "x86_64-apple-darwin"
  if (process.platform === "win32") return process.arch === "arm64" ? "aarch64-pc-windows-msvc" : "x86_64-pc-windows-msvc"
  if (process.platform === "linux") return process.arch === "arm64" ? "aarch64-unknown-linux-gnu" : "x86_64-unknown-linux-gnu"
  throw new Error(`Unsupported platform: ${process.platform}/${process.arch}`)
}

function distName() {
  if (process.platform === "darwin") return process.arch === "arm64" ? "opencode-darwin-arm64" : "opencode-darwin-x64-baseline"
  if (process.platform === "win32") return process.arch === "arm64" ? "opencode-windows-arm64" : "opencode-windows-x64-baseline"
  if (process.platform === "linux") return process.arch === "arm64" ? "opencode-linux-arm64" : "opencode-linux-x64-baseline"
  return "opencode"
}

function detectOpenclawFromEnv(): OpenclawConfig | undefined {
  const url = firstString(
    process.env.OPENCLAW_GATEWAY_URL,
    process.env.OPENCLAW_URL,
    process.env.OPENCLAW_GATEWAY_ENDPOINT,
  )
  const token = firstString(process.env.OPENCLAW_GATEWAY_TOKEN, process.env.OPENCLAW_TOKEN)
  if (!url && !token) return
  return { enabled: true, url, token }
}

function withDefaultOpenclawUrl(config: OpenclawConfig): OpenclawConfig {
  return { ...config, url: config.url?.trim() || DEFAULT_OPENCLAW_GATEWAY_URL }
}

function openclawConfigPaths() {
  const home = homedir()
  const roots = [
    process.env.OPENCLAW_HOME,
    join(home, ".openclaw"),
    join(home, ".config", "openclaw"),
    join(home, ".config", "OpenClaw"),
  ]
  if (process.platform === "darwin") {
    roots.push(join(home, "Library", "Application Support", "OpenClaw"))
    roots.push(join(home, "Library", "Application Support", "openclaw"))
  }
  if (process.platform === "win32") {
    const appData = process.env.APPDATA ?? join(home, "AppData", "Roaming")
    const localAppData = process.env.LOCALAPPDATA ?? join(home, "AppData", "Local")
    roots.push(join(appData, "OpenClaw"))
    roots.push(join(appData, "openclaw"))
    roots.push(join(localAppData, "OpenClaw"))
    roots.push(join(localAppData, "openclaw"))
  }
  return [...new Set(roots.filter((item): item is string => !!item).flatMap((root) => [
    join(root, "openclaw.json"),
    join(root, "config.json"),
  ]))]
}

async function detectOpenclawFromFile(file: string): Promise<OpenclawConfig | undefined> {
  const text = await readFile(file, "utf8").catch(() => undefined)
  if (!text) return
  const data = parseJsonLike(text)
  if (!data || typeof data !== "object") return
  const url = readConfigString(data, [
    "gatewayUrl",
    "gatewayURL",
    "gateway_url",
    "gateway",
    "url",
    "endpoint",
    "wsUrl",
    "websocketUrl",
  ])
  const token = readConfigString(data, ["gatewayToken", "gateway_token", "token", "authToken", "apiKey"])
  if (!url && !token) return
  return { enabled: true, url, token }
}

async function detectOpenclawFromCommand(): Promise<{ config: OpenclawConfig; source: string } | undefined> {
  const commands = process.platform === "win32" ? ["openclaw.exe", "openclaw"] : ["openclaw"]
  for (const command of commands) {
    const json = await runOpenclawStatus(command, true)
    if (json) return { config: json, source: `${command} gateway status --json` }
    const text = await runOpenclawStatus(command, false)
    if (text) return { config: text, source: `${command} gateway status` }
  }
}

async function runOpenclawStatus(command: string, json: boolean): Promise<OpenclawConfig | undefined> {
  const args = ["gateway", "status", ...(json ? ["--json"] : [])]
  const result = await execFileAsync(command, args, { timeout: 3000, windowsHide: true }).catch(() => undefined)
  if (!result?.stdout) return
  if (json) {
    const data = parseJsonLike(result.stdout)
    if (data && typeof data === "object") {
      const url = readConfigString(data, ["gatewayUrl", "url", "endpoint", "wsUrl", "websocketUrl"])
      const token = readConfigString(data, ["gatewayToken", "token"])
      if (url || token) return { enabled: true, url, token }
    }
  }
  const url = result.stdout.match(/\b(?:wss?|https?):\/\/[^\s"'<>]+/i)?.[0]
  const token = result.stdout.match(/\b(?:token|gatewayToken)\s*[:=]\s*([^\s"'<>]+)/i)?.[1]
  if (!url && !token) return
  return { enabled: true, url, token }
}

function parseJsonLike(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

function readConfigString(input: unknown, keys: string[]): string | undefined {
  if (!input || typeof input !== "object") return
  const record = input as Record<string, unknown>
  for (const key of keys) {
    const value = record[key]
    if (typeof value === "string" && value.trim()) return value.trim()
  }
  for (const value of Object.values(record)) {
    const nested = readConfigString(value, keys)
    if (nested) return nested
  }
}

function firstString(...values: Array<string | undefined>) {
  return values.find((value) => typeof value === "string" && value.trim())?.trim()
}

async function configFile(id: string, label: string, path: string, scope: string, kind: string): Promise<ConfigFile> {
  return {
    id,
    label,
    path,
    scope,
    kind,
    exists: await exists(path),
  }
}

async function collectWorkspaceFiles(roots: string[], extensions: string[]) {
  const output: ConfigWorkspace["agents"] = []
  for (const root of roots) {
    registerAllowedRoot(root)
    const entries = await walkFiles(root, extensions)
    output.push(...entries.map((path) => ({ name: basename(path).replace(/\.[^.]+$/, ""), path, kind: "file" })))
  }
  return output.sort((a, b) => a.name.localeCompare(b.name))
}

async function walkFiles(root: string, extensions: string[]): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true }).catch(() => [])
  const output: string[] = []
  for (const entry of entries) {
    const path = join(root, entry.name)
    if (entry.isDirectory()) {
      output.push(...(await walkFiles(path, extensions)))
      continue
    }
    if (extensions.some((ext) => entry.name.toLowerCase().endsWith(ext))) output.push(path)
  }
  return output
}

function assertAllowedLocalPath(path: string) {
  if (!path || !isAbsolute(path)) throw new Error("Expected an absolute path")
  const target = resolve(path)
  const roots = [homedir(), app.getPath("userData"), process.cwd(), ...allowedRoots].map((root) => resolve(root))
  if (roots.some((root) => isInside(target, root))) return target
  throw new Error(`Path is outside allowed desktop roots: ${target}`)
}

function isInside(path: string, root: string) {
  const rel = relative(root, path)
  return rel === "" || (!!rel && !rel.startsWith("..") && !isAbsolute(rel))
}

async function exists(path: string) {
  return access(path, fsConstants.F_OK)
    .then(() => true)
    .catch(() => false)
}

function parseStoreObject<T extends object>(key: string, fallback: T): T {
  const value = getStore().get(key)
  if (!value || typeof value !== "object" || Array.isArray(value)) return fallback
  return { ...fallback, ...value } as T
}

function stringOrUndefined(value: unknown) {
  return typeof value === "string" ? value : undefined
}
