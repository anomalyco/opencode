// Synchronous fs shim for browser (node:fs compatible).
// Delegates to the shared browser VFS and optional external workspace bridge.

import { Readable, Writable } from "stream"
import {
  _vfs_addDir,
  _vfs_exists,
  _vfs_getFile,
  _vfs_isDir,
  _vfs_readdir,
  _vfs_remove,
  _vfs_setFile,
  type BrowserWorkspaceDirent,
} from "./fs.browser"

function normalizePath(p: string): string {
  const parts = p.split("/").filter(Boolean)
  const resolved: string[] = []
  for (const part of parts) {
    if (part === "..") resolved.pop()
    else if (part !== ".") resolved.push(part)
  }
  return "/" + resolved.join("/")
}

function enoent(action: string, path: string): Error & { code: "ENOENT" } {
  const error = new Error(`ENOENT: no such file or directory, ${action} '${path}'`) as Error & { code: "ENOENT" }
  error.code = "ENOENT"
  return error
}

export function readFileSync(path: string, encoding?: string): string | Buffer {
  const content = _vfs_getFile(path)
  if (content === undefined) {
    throw enoent("open", path)
  }

  return encoding ? content : Buffer.from(content)
}

export function writeFileSync(path: string, data: string | Uint8Array): void {
  const content = typeof data === "string" ? data : new TextDecoder().decode(data)
  _vfs_setFile(path, content)
}

export function existsSync(path: string): boolean {
  return _vfs_exists(path)
}

export function mkdirSync(path: string, _opts?: any): void {
  _vfs_addDir(path)
}

export function readdirSync(path: string, opts?: any): any[] {
  const entries = _vfs_readdir(path)
  return entries.map((entry: BrowserWorkspaceDirent) => (opts?.withFileTypes ? entry : entry.name))
}

export function statSync(path: string, opts?: any): any {
  if (!_vfs_exists(path)) {
    if (opts?.throwIfNoEntry === false) return undefined
    throw enoent("stat", path)
  }

  const normalized = normalizePath(path)
  if (_vfs_isDir(normalized)) {
    return {
      isFile: () => false,
      isDirectory: () => true,
      size: 0,
      mtime: new Date(),
      mtimeMs: Date.now(),
    }
  }

  const content = _vfs_getFile(normalized) ?? ""
  return {
    isFile: () => true,
    isDirectory: () => false,
    size: new TextEncoder().encode(content).length,
    mtime: new Date(),
    mtimeMs: Date.now(),
  }
}

export const lstatSync = statSync

export function realpathSync(path: string): string {
  return normalizePath(path)
}

realpathSync.native = realpathSync

export function accessSync(path: string): void {
  if (!_vfs_exists(path)) {
    throw enoent("access", path)
  }
}

export function unlinkSync(path: string): void {
  _vfs_remove(path)
}

export function rmSync(path: string, opts?: { recursive?: boolean; force?: boolean }): void {
  if (!opts?.force && !_vfs_exists(path)) {
    throw enoent("rm", path)
  }

  if (_vfs_isDir(path)) {
    return
  }

  _vfs_remove(path, { recursive: Boolean(opts?.recursive) })
}

export function chmodSync(): void {}
export function chownSync(): void {}
export function renameSync(oldPath: string, newPath: string): void {
  const content = _vfs_getFile(oldPath)
  if (content === undefined) {
    throw enoent("rename", oldPath)
  }
  _vfs_setFile(newPath, content)
  _vfs_remove(oldPath)
}

export const constants = {
  F_OK: 0,
  R_OK: 4,
  W_OK: 2,
  X_OK: 1,
}

export function createReadStream(path: string) {
  const content = readFileSync(path, "utf8")
  return Readable.from(String(content))
}

export function createWriteStream(path: string) {
  const chunks: Buffer[] = []
  return new Writable({
    write(chunk, _encoding, callback) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
      callback()
    },
    final(callback) {
      writeFileSync(path, Buffer.concat(chunks))
      callback()
    },
  })
}

// Re-export promises API
export { default as promises } from "./fs.browser"

export default {
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  statSync,
  lstatSync,
  realpathSync,
  accessSync,
  unlinkSync,
  rmSync,
  chmodSync,
  chownSync,
  renameSync,
  constants,
  createReadStream,
  createWriteStream,
  promises: import("./fs.browser"),
}
