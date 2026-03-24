// Browser-compatible fs/promises shim.
// Internal OpenCode state lives in-memory, while /workspace can optionally proxy
// to an external host such as almostnode's VFS.

const WORKSPACE_ROOT = "/workspace"

const _files = new Map<string, string>()
const _dirs = new Set<string>([
  "/",
  "/opencode",
  "/opencode/data",
  "/opencode/cache",
  "/opencode/config",
  "/opencode/state",
  "/opencode/data/log",
  "/opencode/cache/bin",
  WORKSPACE_ROOT,
])

export interface BrowserWorkspaceDirent {
  name: string
  isDirectory: () => boolean
  isFile: () => boolean
}

export interface BrowserWorkspaceStats {
  isFile: () => boolean
  isDirectory: () => boolean
  size: number
  mtime: Date
  mtimeMs: number
}

export interface BrowserWorkspaceBridge {
  exists(path: string): boolean
  mkdir(path: string): void
  readFile(path: string): string | undefined
  writeFile(path: string, content: string): void
  readdir(path: string): BrowserWorkspaceDirent[]
  stat(path: string): BrowserWorkspaceStats | undefined
  remove?(path: string, opts?: { recursive?: boolean }): void
  rename?(oldPath: string, newPath: string): void
  listFiles?(root?: string): string[]
}

let workspaceBridge: BrowserWorkspaceBridge | null = null

export function attachWorkspaceBridge(bridge: BrowserWorkspaceBridge): void {
  workspaceBridge = bridge
  _dirs.add(WORKSPACE_ROOT)
}

export function detachWorkspaceBridge(): void {
  workspaceBridge = null
}

function normalizePath(p: string): string {
  const parts = p.split("/").filter(Boolean)
  const resolved: string[] = []
  for (const part of parts) {
    if (part === "..") resolved.pop()
    else if (part !== ".") resolved.push(part)
  }
  return "/" + resolved.join("/")
}

function ensureParentDirs(filePath: string) {
  const parts = filePath.split("/").filter(Boolean)
  let current = ""
  for (let index = 0; index < parts.length - 1; index += 1) {
    current += "/" + parts[index]
    _dirs.add(current)
  }
}

function isWorkspacePath(path: string): boolean {
  return path === WORKSPACE_ROOT || path.startsWith(`${WORKSPACE_ROOT}/`)
}

function getWorkspaceBridge(path: string): BrowserWorkspaceBridge | null {
  if (!workspaceBridge) return null
  return isWorkspacePath(path) ? workspaceBridge : null
}

function createDirent(name: string, type: "file" | "directory"): BrowserWorkspaceDirent {
  return {
    name,
    isDirectory: () => type === "directory",
    isFile: () => type === "file",
  }
}

function createStats(type: "file" | "directory", size: number): BrowserWorkspaceStats {
  return {
    isFile: () => type === "file",
    isDirectory: () => type === "directory",
    size,
    mtime: new Date(),
    mtimeMs: Date.now(),
  }
}

function readInternalFile(path: string): string | undefined {
  return _files.get(path)
}

function hasInternalDir(path: string): boolean {
  return _dirs.has(path)
}

function listInternal(path: string): BrowserWorkspaceDirent[] {
  const results: BrowserWorkspaceDirent[] = []
  const seen = new Set<string>()

  for (const [filePath] of _files) {
    if (!filePath.startsWith(`${path}/`)) continue
    const relative = filePath.slice(path.length + 1)
    const name = relative.split("/")[0]
    if (!name || seen.has(name)) continue
    seen.add(name)
    results.push(createDirent(name, relative.includes("/") ? "directory" : "file"))
  }

  for (const dirPath of _dirs) {
    if (!dirPath.startsWith(`${path}/`) || dirPath === path) continue
    const relative = dirPath.slice(path.length + 1)
    const name = relative.split("/")[0]
    if (!name || seen.has(name)) continue
    seen.add(name)
    results.push(createDirent(name, "directory"))
  }

  return results
}

function internalExists(path: string): boolean {
  return _files.has(path) || _dirs.has(path)
}

function internalStat(path: string): BrowserWorkspaceStats | undefined {
  const content = _files.get(path)
  if (content !== undefined) {
    return createStats("file", new TextEncoder().encode(content).length)
  }

  if (_dirs.has(path)) {
    return createStats("directory", 0)
  }

  return undefined
}

function enoent(action: string, path: string): Error & { code: "ENOENT" } {
  const error = new Error(`ENOENT: no such file or directory, ${action} '${path}'`) as Error & { code: "ENOENT" }
  error.code = "ENOENT"
  return error
}

export async function mkdir(path: string, _opts?: any): Promise<void> {
  const normalized = normalizePath(path)
  const bridge = getWorkspaceBridge(normalized)
  if (bridge) {
    bridge.mkdir(normalized)
    return
  }

  _dirs.add(normalized)
  const parts = normalized.split("/").filter(Boolean)
  let current = ""
  for (const part of parts) {
    current += "/" + part
    _dirs.add(current)
  }
}

export async function readFile(path: string, encoding?: string): Promise<string | Uint8Array> {
  const normalized = normalizePath(path)
  const bridge = getWorkspaceBridge(normalized)
  const content = bridge ? bridge.readFile(normalized) : readInternalFile(normalized)
  if (content === undefined) {
    throw enoent("open", path)
  }

  if (encoding === "utf-8" || encoding === "utf8") return content
  return new TextEncoder().encode(content)
}

export async function writeFile(path: string, data: string | Uint8Array, _opts?: any): Promise<void> {
  const normalized = normalizePath(path)
  const content = typeof data === "string" ? data : new TextDecoder().decode(data)
  const bridge = getWorkspaceBridge(normalized)
  if (bridge) {
    bridge.writeFile(normalized, content)
    return
  }

  ensureParentDirs(normalized)
  _files.set(normalized, content)
}

export async function appendFile(path: string, data: string | Uint8Array, _opts?: any): Promise<void> {
  const normalized = normalizePath(path)
  const previous = await readFile(normalized, "utf8").catch(() => "")
  const next =
    previous + (typeof data === "string" ? data : new TextDecoder().decode(data))
  await writeFile(normalized, next)
}

export async function readdir(path: string, opts?: any): Promise<any[]> {
  const normalized = normalizePath(path)
  const bridge = getWorkspaceBridge(normalized)
  const entries = bridge ? bridge.readdir(normalized) : listInternal(normalized)
  return entries.map((entry) =>
    opts?.withFileTypes
      ? entry
      : entry.name
  )
}

export async function stat(path: string): Promise<any> {
  const normalized = normalizePath(path)
  const bridge = getWorkspaceBridge(normalized)
  const value = bridge ? bridge.stat(normalized) : internalStat(normalized)
  if (value) {
    return value
  }

  throw enoent("stat", path)
}

export const lstat = stat

export async function open(path: string, _flags?: string): Promise<{
  read(buffer: Uint8Array, offset?: number, length?: number, position?: number): Promise<{ bytesRead: number; buffer: Uint8Array }>
  close(): Promise<void>
}> {
  const content = await readFile(path)
  const bytes = typeof content === "string" ? new TextEncoder().encode(content) : content

  return {
    async read(buffer: Uint8Array, offset = 0, length = buffer.length, position = 0) {
      const chunk = bytes.slice(position, position + length)
      buffer.set(chunk, offset)
      return {
        bytesRead: chunk.length,
        buffer,
      }
    },
    async close() {},
  }
}

export async function access(path: string): Promise<void> {
  const normalized = normalizePath(path)
  const bridge = getWorkspaceBridge(normalized)
  const exists = bridge ? bridge.exists(normalized) : internalExists(normalized)
  if (!exists) {
    throw enoent("access", path)
  }
}

export async function unlink(path: string): Promise<void> {
  const normalized = normalizePath(path)
  const bridge = getWorkspaceBridge(normalized)
  if (bridge?.remove) {
    bridge.remove(normalized)
    return
  }

  _files.delete(normalized)
}

export async function rm(path: string, opts?: any): Promise<void> {
  const normalized = normalizePath(path)
  const bridge = getWorkspaceBridge(normalized)
  if (bridge?.remove) {
    bridge.remove(normalized, { recursive: Boolean(opts?.recursive) })
    return
  }

  _files.delete(normalized)
  if (opts?.recursive) {
    for (const key of Array.from(_files.keys())) {
      if (key.startsWith(`${normalized}/`)) _files.delete(key)
    }
    for (const dir of Array.from(_dirs.values())) {
      if (dir === normalized || dir.startsWith(`${normalized}/`)) _dirs.delete(dir)
    }
  }
}

export async function rename(oldPath: string, newPath: string): Promise<void> {
  const oldNorm = normalizePath(oldPath)
  const newNorm = normalizePath(newPath)
  const bridge = getWorkspaceBridge(oldNorm)
  if (bridge?.rename) {
    bridge.rename(oldNorm, newNorm)
    return
  }

  const content = _files.get(oldNorm)
  if (content !== undefined) {
    ensureParentDirs(newNorm)
    _files.set(newNorm, content)
    _files.delete(oldNorm)
  }
}

export async function copyFile(src: string, dest: string): Promise<void> {
  const srcNorm = normalizePath(src)
  const destNorm = normalizePath(dest)
  const content = await readFile(srcNorm, "utf8")
  await writeFile(destNorm, String(content))
}

export async function realpath(path: string): Promise<string> {
  return normalizePath(path)
}

export async function chmod(): Promise<void> {}
export async function chown(): Promise<void> {}
export async function utimes(): Promise<void> {}
export async function link(): Promise<void> {}
export async function symlink(): Promise<void> {}
export async function readlink(path: string): Promise<string> {
  return path
}
export async function mkdtemp(prefix: string): Promise<string> {
  const dir = prefix + Math.random().toString(36).slice(2, 8)
  await mkdir(dir)
  return dir
}

export function _vfs_setFile(path: string, content: string) {
  const normalized = normalizePath(path)
  const bridge = getWorkspaceBridge(normalized)
  if (bridge) {
    bridge.writeFile(normalized, content)
    return
  }

  ensureParentDirs(normalized)
  _files.set(normalized, content)
}

export function _vfs_getFile(path: string): string | undefined {
  const normalized = normalizePath(path)
  const bridge = getWorkspaceBridge(normalized)
  return bridge ? bridge.readFile(normalized) : _files.get(normalized)
}

export function _vfs_listAll(): Map<string, string> {
  const result = new Map(_files)

  if (workspaceBridge) {
    const files = workspaceBridge.listFiles?.(WORKSPACE_ROOT) ?? []
    for (const path of files) {
      const normalized = normalizePath(path)
      const content = workspaceBridge.readFile(normalized)
      if (content !== undefined) {
        result.set(normalized, content)
      }
    }
  }

  return result
}

export function _vfs_addDir(path: string) {
  const normalized = normalizePath(path)
  const bridge = getWorkspaceBridge(normalized)
  if (bridge) {
    bridge.mkdir(normalized)
    return
  }

  _dirs.add(normalized)
}

export function _vfs_remove(path: string, opts?: { recursive?: boolean }) {
  const normalized = normalizePath(path)
  const bridge = getWorkspaceBridge(normalized)
  if (bridge?.remove) {
    bridge.remove(normalized, opts)
    return
  }

  _files.delete(normalized)
  if (opts?.recursive) {
    for (const key of Array.from(_files.keys())) {
      if (key.startsWith(`${normalized}/`)) _files.delete(key)
    }
    for (const dir of Array.from(_dirs.values())) {
      if (dir === normalized || dir.startsWith(`${normalized}/`)) _dirs.delete(dir)
    }
  }
}

export function _vfs_exists(path: string): boolean {
  const normalized = normalizePath(path)
  const bridge = getWorkspaceBridge(normalized)
  return bridge ? bridge.exists(normalized) : internalExists(normalized)
}

export function _vfs_isDir(path: string): boolean {
  const normalized = normalizePath(path)
  const bridge = getWorkspaceBridge(normalized)
  const value = bridge ? bridge.stat(normalized) : internalStat(normalized)
  return Boolean(value?.isDirectory())
}

export function _vfs_readdir(path: string): BrowserWorkspaceDirent[] {
  const normalized = normalizePath(path)
  const bridge = getWorkspaceBridge(normalized)
  return bridge ? bridge.readdir(normalized) : listInternal(normalized)
}

export default {
  mkdir,
  readFile,
  writeFile,
  readdir,
  stat,
  lstat,
  open,
  access,
  unlink,
  rm,
  rename,
  copyFile,
  realpath,
  chmod,
  chown,
  utimes,
  link,
  symlink,
  readlink,
  mkdtemp,
  attachWorkspaceBridge,
  detachWorkspaceBridge,
  _vfs_setFile,
  _vfs_getFile,
  _vfs_listAll,
  _vfs_addDir,
  _vfs_remove,
  _vfs_exists,
  _vfs_isDir,
  _vfs_readdir,
}
