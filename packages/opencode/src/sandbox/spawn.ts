import { Config } from "@/config/config"
import { Flag } from "@/flag/flag"
import { Global } from "@/global"
import { BashArity } from "@/permission/arity"
import { Log } from "@/util/log"
import { Filesystem } from "@/util/filesystem"
import os from "os"
import path from "path"
import { SandboxPolicy } from "./policy"

const log = Log.create({ service: "sandbox" })
const bin = "/usr/bin/sandbox-exec"

export namespace SandboxSpawn {
  export type Mode = SandboxPolicy.Mode

  export interface Diag {
    requested: boolean
    active: boolean
    reason: "disabled" | "unsupported_platform" | "sandbox_exec_missing" | "unsafe_root" | "enabled"
    wrapper: string
    cwd: string
    mode: Mode
    read_roots: string[]
    write_roots: string[]
    unsafe_roots: string[]
    allow_network: boolean
    allow_unix_sockets: boolean
  }

  export interface Settings {
    requested: boolean
    mode: Mode
    extra_read_roots: string[]
    extra_write_roots: string[]
    extra_deny_paths: string[]
    excluded_commands: string[]
    allow_unsandboxed_retry: boolean
    fail_if_unavailable: boolean
  }

  export interface ResolveInput {
    cwd: string
    project_root: string
    worktree_root: string
    allow_network?: boolean
    allow_unix_sockets?: boolean
  }

  export interface PlanInput extends ResolveInput {
    requested: boolean
    platform: NodeJS.Platform
    available: boolean
    home: string
    mode?: Mode
    fail_if_unavailable?: boolean
    opencode_roots?: string[]
    extra_read_roots?: string[]
    extra_write_roots?: string[]
    extra_deny_paths?: string[]
  }

  export interface Output {
    active: boolean
    profile?: string
    diag: Diag
  }

  export interface WrapInput {
    profile: string
    file: string
    args: string[]
  }

  export class Error extends globalThis.Error {
    readonly diag: Diag

    constructor(diag: Diag) {
      super(`macOS sandbox is enabled but unavailable: ${diag.reason}`)
      this.name = "SandboxSpawnError"
      this.diag = diag
    }
  }

  export class CommandError extends globalThis.Error {
    readonly command: string
    readonly rule: string

    constructor(command: string, rule: string) {
      super(`Command \"${command}\" is blocked by excluded_commands entry \"${rule}\"`)
      this.name = "SandboxCommandError"
      this.command = command
      this.rule = rule
    }
  }

  export interface Match {
    command: string
    rule: string
  }

  function uniq(input: string[]) {
    return [...new Set(input.filter(Boolean))].toSorted((a, b) => a.localeCompare(b))
  }

  function name(input: string) {
    return process.platform === "win32" ? path.win32.basename(input, ".exe") : path.basename(input)
  }

  function parts(input: string[]) {
    if (input.length === 0) return []
    const head = name(input[0]) || input[0]
    return [head, ...input.slice(1)]
  }

  function prefix(input: string[]) {
    return BashArity.prefix(parts(input)).join(" ")
  }

  function trim(input: string) {
    return input.replace(/^['"]|['"]$/g, "")
  }

  function assign(input: string) {
    return /^[A-Za-z_][A-Za-z0-9_]*=/.test(input)
  }

  function shell(input: string) {
    const out: string[][] = []
    let next: string[] = []
    for (const item of input.match(
      /&&|\|\||(?<![0-9>])&(?![0-9])|[|;\n]|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|[^\s|;&\n]+/g,
    ) ?? []) {
      if (["&&", "||", "|", ";", "&", "\n"].includes(item)) {
        if (next.length > 0) out.push(next)
        next = []
        continue
      }
      next.push(trim(item))
    }
    if (next.length > 0) out.push(next)
    return out
  }

  function list(input: string[]): string[][] {
    const next = [...input]
    while (assign(next[0] ?? "")) next.shift()
    if (next.length === 0) return []

    const head = name(next[0]).toLowerCase()
    if (head === "env") {
      const rest = next.slice(1)
      while (rest[0]?.startsWith("-")) rest.shift()
      while (assign(rest[0] ?? "")) rest.shift()
      return list(rest)
    }

    if (["sh", "bash", "zsh", "fish", "nu"].includes(head)) {
      const idx = next.findIndex((item) => item === "-c" || item === "/c" || item === "-Command")
      if (idx >= 0 && next[idx + 1]) {
        return shell(next[idx + 1]).flatMap(list)
      }
    }

    return [next]
  }

  function scan(input: string[], home: string) {
    return uniq(input).reduce(
      (acc, item) => {
        if (item === "/") {
          acc.bad.push(item)
          return acc
        }
        if (item === home || Filesystem.contains(item, home)) {
          acc.bad.push(item)
          return acc
        }
        acc.good.push(item)
        return acc
      },
      { good: [] as string[], bad: [] as string[] },
    )
  }

  function base(input: PlanInput, reason: Diag["reason"]) {
    return {
      requested: input.requested,
      active: false,
      reason,
      wrapper: bin,
      cwd: input.cwd,
      mode: input.mode ?? "workspace-write",
      read_roots: [],
      write_roots: [],
      unsafe_roots: [],
      allow_network: input.allow_network === true,
      allow_unix_sockets: input.allow_unix_sockets === true,
    } satisfies Diag
  }

  export function settings(): Promise<Settings> {
    return Config.get().then((cfg) => {
      const env = process.env["OPENCODE_EXPERIMENTAL_SANDBOX"]
      const raw = cfg.experimental?.sandbox
      return {
        requested: env === undefined ? raw?.enabled === true : Flag.OPENCODE_EXPERIMENTAL_SANDBOX,
        mode: raw?.mode ?? "workspace-write",
        extra_read_roots: raw?.extra_read_roots ?? [],
        extra_write_roots: raw?.extra_write_roots ?? [],
        extra_deny_paths: raw?.extra_deny_paths ?? [],
        excluded_commands: raw?.excluded_commands ?? [],
        allow_unsandboxed_retry: raw?.allow_unsandboxed_retry === true,
        fail_if_unavailable: raw?.fail_if_unavailable === true,
      } satisfies Settings
    })
  }

  export function excluded(input: string[], blocked: string[]): Match | undefined {
    for (const candidate of list(input)) {
      const command = prefix(candidate)
      if (!command) continue
      for (const item of blocked) {
        const rule = prefix(item.trim().split(/\s+/).filter(Boolean))
        if (!rule) continue
        if (command === rule || command.startsWith(`${rule} `)) {
          return { command, rule }
        }
      }
    }
  }

  export function excludedText(input: string, blocked: string[]) {
    for (const item of shell(input)) {
      const match = excluded(item, blocked)
      if (match) return match
    }
  }

  export function shouldRetry(input: { active: boolean; code: number; stderr: string }) {
    if (!input.active || input.code === 0) return false
    if (input.stderr.includes("sandbox-exec: sandbox_apply: Operation not permitted")) return true
    if (input.stderr.includes("sandbox-exec: execvp()")) return true
    if (input.stderr.includes("forbidden-sandbox-reinit")) return true
    if (input.stderr.includes("Sandbox:") && input.stderr.includes("deny(1)")) return true
    if (input.stderr.includes("Operation not permitted")) return true
    return false
  }

  export function unwrap(input: { file: string; args: string[] }) {
    if (input.file !== bin) return input
    if (input.args[0] !== "-p") return input
    const file = input.args[2]
    if (!file) return input
    return {
      file,
      args: input.args.slice(3),
    }
  }

  export function plan(input: PlanInput): Output {
    if (!input.requested) {
      return { active: false, diag: base(input, "disabled") }
    }

    if (input.platform !== "darwin") {
      const diag = base(input, "unsupported_platform")
      if (input.fail_if_unavailable) throw new Error(diag)
      return { active: false, diag }
    }

    if (!input.available) {
      const diag = base(input, "sandbox_exec_missing")
      if (input.fail_if_unavailable) throw new Error(diag)
      return { active: false, diag }
    }

    const read = scan(
      [...(input.extra_read_roots ?? []), input.cwd, input.project_root, input.worktree_root],
      input.home,
    )
    const write = scan(
      input.mode === "read-only"
        ? [...(input.extra_write_roots ?? [])]
        : [...(input.extra_write_roots ?? []), input.cwd, input.project_root, input.worktree_root],
      input.home,
    )
    const bad = uniq([...read.bad, ...write.bad])

    if (bad.length > 0) {
      throw new Error({
        ...base(input, "unsafe_root"),
        unsafe_roots: bad,
      })
    }

    const policy = SandboxPolicy.build({
      cwd: input.cwd,
      project_root: input.project_root,
      worktree_root: input.worktree_root,
      home: input.home,
      extra_read_roots: read.good,
      extra_write_roots: write.good,
      extra_deny_paths: input.extra_deny_paths,
      opencode_roots: input.opencode_roots,
      mode: input.mode,
      allow_network: input.allow_network,
      allow_unix_sockets: input.allow_unix_sockets,
    })

    const diag = {
      requested: true,
      active: true,
      reason: "enabled",
      wrapper: bin,
      cwd: input.cwd,
      mode: input.mode ?? "workspace-write",
      read_roots: policy.read,
      write_roots: policy.write,
      unsafe_roots: [],
      allow_network: input.allow_network === true,
      allow_unix_sockets: input.allow_unix_sockets === true,
    } satisfies Diag

    return {
      active: true,
      profile: policy.profile,
      diag,
    }
  }

  export function wrap(input: WrapInput) {
    return {
      file: bin,
      args: ["-p", input.profile, input.file, ...input.args],
    }
  }

  export async function resolve(input: ResolveInput, cfg?: Settings): Promise<Output> {
    const raw = cfg ?? (await settings())
    const home = Filesystem.resolve(Global.Path.home)
    const tmp = Filesystem.resolve(os.tmpdir())
    const temp = Filesystem.contains(tmp, home) ? [] : [tmp]
    const out = plan({
      requested: raw.requested,
      platform: process.platform,
      available: Boolean(Filesystem.stat(bin)?.size),
      cwd: Filesystem.resolve(input.cwd),
      project_root: Filesystem.resolve(input.project_root),
      worktree_root: Filesystem.resolve(input.worktree_root),
      home,
      mode: raw.mode,
      fail_if_unavailable: raw.fail_if_unavailable,
      opencode_roots: [Global.Path.data, Global.Path.config, Global.Path.state, Global.Path.cache].map(
        Filesystem.resolve,
      ),
      extra_read_roots: [...raw.extra_read_roots, ...temp].map(Filesystem.resolve),
      extra_write_roots:
        raw.mode === "read-only"
          ? raw.extra_write_roots.map(Filesystem.resolve)
          : [...raw.extra_write_roots, ...temp].map(Filesystem.resolve),
      extra_deny_paths: raw.extra_deny_paths.map(Filesystem.resolve),
      allow_network: input.allow_network,
      allow_unix_sockets: input.allow_unix_sockets,
    })

    if (out.active) log.debug("sandbox active", out.diag)
    else if (out.diag.requested) log.info("sandbox inactive", out.diag)
    else log.debug("sandbox disabled", out.diag)

    return out
  }
}
