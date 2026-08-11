export * as ShellSelect from "./select"

import path from "path"
import { readFile } from "fs/promises"
import { statSync } from "fs"
import { Schema } from "effect"
import { FSUtil } from "@opencode-ai/util/fs-util"
import { which } from "../util/which"

const META: Record<string, { deny?: boolean; login?: boolean; ps?: boolean }> = {
  bash: { login: true },
  dash: { login: true },
  fish: { deny: true, login: true },
  ksh: { login: true },
  nu: { deny: true },
  powershell: { ps: true },
  pwsh: { ps: true },
  sh: { login: true },
  zsh: { login: true },
}

export type Item = {
  path: string
  name: string
  acceptable: boolean
}

export const Options = Schema.Struct({
  gitbash: Schema.optional(Schema.String),
})
export type Options = typeof Options.Type

function stat(file: string) {
  return statSync(file, { throwIfNoEntry: false }) ?? undefined
}

function findExecutable(name: string, bin?: string) {
  return which(name, undefined, bin)
}

function full(file: string, options?: Options, bin?: string) {
  if (process.platform !== "win32") return file
  const shell = FSUtil.windowsPath(file)
  if (path.win32.dirname(shell) !== ".") {
    if (shell.startsWith("/") && name(shell) === "bash") return gitbash(options, bin) || shell
    return shell
  }
  if (name(shell) === "bash") return gitbash(options, bin) || findExecutable(shell, bin) || shell
  return findExecutable(shell, bin) || shell
}

function meta(file: string) {
  return META[name(file)]
}

function ok(file: string) {
  return meta(file)?.deny !== true
}

function rooted(file: string) {
  return path.isAbsolute(FSUtil.windowsPath(file))
}

function resolve(file: string, options?: Options, bin?: string) {
  const shell = full(file, options, bin)
  if (rooted(shell)) {
    if (stat(shell)?.isFile()) return shell
    return
  }
  return findExecutable(shell, bin) ?? undefined
}

function win(options?: Options, bin?: string) {
  return Array.from(
    new Set(
      [
        findExecutable("pwsh", bin),
        findExecutable("powershell", bin),
        gitbash(options, bin),
        process.env.COMSPEC || "cmd.exe",
      ]
        .filter((item): item is string => Boolean(item))
        .map((file) => full(file, options, bin)),
    ),
  )
}

async function unix() {
  const text = await readFile("/etc/shells", "utf8").catch(() => "")
  if (text) return Array.from(new Set(text.split("\n").filter((line) => line.trim() && !line.startsWith("#"))))
  return ["/bin/bash", "/bin/zsh", "/bin/sh"]
}

function select(file: string | undefined, options?: Options, opts?: { acceptable?: boolean }, bin?: string) {
  if (file && (!opts?.acceptable || ok(file))) {
    const shell = resolve(file, options, bin)
    if (shell) return shell
  }
  if (process.platform === "win32") return win(options, bin)[0]
  return fallback(bin)
}

export function gitbash(options?: Options, bin?: string) {
  if (process.platform !== "win32") return
  if (options?.gitbash) return options.gitbash
  const git = findExecutable("git", bin)
  if (!git) return
  const file = path.join(git, "..", "..", "bin", "bash.exe")
  if (stat(file)?.size) return file
}

function fallback(bin?: string) {
  if (process.platform === "darwin") return "/bin/zsh"
  const bash = findExecutable("bash", bin)
  if (bash) return bash
  return "/bin/sh"
}

export function name(file: string) {
  if (process.platform === "win32") return path.win32.parse(FSUtil.windowsPath(file)).name.toLowerCase()
  return path.basename(file).toLowerCase()
}

export function login(file: string) {
  return meta(file)?.login === true
}

export function ps(file: string) {
  return meta(file)?.ps === true
}

function info(file: string, options?: Options, bin?: string): Item {
  const item = full(file, options, bin)
  const n = name(item)
  return {
    path: item,
    name: resolve(n, options, bin) ? n : item,
    acceptable: ok(item),
  }
}

export function args(file: string, command: string) {
  const n = name(file)
  if (n === "nu" || n === "fish") return ["-c", command]
  if (n === "zsh" || n === "bash") return ["-c", command]
  if (n === "cmd") return ["/c", command]
  if (ps(file)) return ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", command]
  return ["-c", command]
}

let defaultPreferred: { bin?: string; value: string } | undefined
let defaultAcceptable: { bin?: string; value: string } | undefined

export function preferred(configShell?: string, options?: Options, bin?: string) {
  if (configShell) return select(configShell, options, undefined, bin)
  if (options?.gitbash) return select(process.env.SHELL, options, undefined, bin)
  const cached = defaultPreferred
  if (cached && cached.bin === bin) return cached.value
  const value = select(process.env.SHELL, undefined, undefined, bin) ?? fallback(bin)
  defaultPreferred = { bin, value }
  return value
}
preferred.reset = () => {
  defaultPreferred = undefined
}

export function acceptable(configShell?: string, options?: Options, bin?: string) {
  if (configShell) return select(configShell, options, { acceptable: true }, bin)
  if (options?.gitbash) return select(process.env.SHELL, options, { acceptable: true }, bin)
  const cached = defaultAcceptable
  if (cached && cached.bin === bin) return cached.value
  const value = select(process.env.SHELL, undefined, { acceptable: true }, bin) ?? fallback(bin)
  defaultAcceptable = { bin, value }
  return value
}
acceptable.reset = () => {
  defaultAcceptable = undefined
}

export async function list(options?: Options, bin?: string): Promise<Item[]> {
  const shells = process.platform === "win32" ? win(options, bin) : await unix()
  return shells.filter((shell) => resolve(shell, options, bin)).map((shell) => info(shell, options, bin))
}
