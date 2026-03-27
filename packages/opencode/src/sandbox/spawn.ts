import { Config } from "@/config/config"
import { Flag } from "@/flag/flag"
import { Global } from "@/global"
import { Log } from "@/util/log"
import { Filesystem } from "@/util/filesystem"
import os from "os"
import { SandboxPolicy } from "./policy"

const log = Log.create({ service: "sandbox" })
const bin = "/usr/bin/sandbox-exec"

export namespace SandboxSpawn {
  export interface Diag {
    requested: boolean
    active: boolean
    reason: "disabled" | "unsupported_platform" | "sandbox_exec_missing" | "unsafe_root" | "enabled"
    wrapper: string
    cwd: string
    read_roots: string[]
    write_roots: string[]
    unsafe_roots: string[]
    allow_network: boolean
    allow_unix_sockets: boolean
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
    opencode_roots?: string[]
    extra_read_roots?: string[]
    extra_write_roots?: string[]
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

  function uniq(input: string[]) {
    return [...new Set(input.filter(Boolean))].toSorted((a, b) => a.localeCompare(b))
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
      read_roots: [],
      write_roots: [],
      unsafe_roots: [],
      allow_network: input.allow_network === true,
      allow_unix_sockets: input.allow_unix_sockets === true,
    } satisfies Diag
  }

  export function plan(input: PlanInput): Output {
    if (!input.requested) {
      return { active: false, diag: base(input, "disabled") }
    }

    if (input.platform !== "darwin") {
      return { active: false, diag: base(input, "unsupported_platform") }
    }

    if (!input.available) {
      throw new Error(base(input, "sandbox_exec_missing"))
    }

    const read = scan(
      [...(input.extra_read_roots ?? []), input.cwd, input.project_root, input.worktree_root],
      input.home,
    )
    const write = scan(
      [...(input.extra_write_roots ?? []), input.cwd, input.project_root, input.worktree_root],
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
      opencode_roots: input.opencode_roots,
      allow_network: input.allow_network,
      allow_unix_sockets: input.allow_unix_sockets,
    })

    const diag = {
      requested: true,
      active: true,
      reason: "enabled",
      wrapper: bin,
      cwd: input.cwd,
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

  export async function resolve(input: ResolveInput): Promise<Output> {
    const cfg = await Config.get()
    const env = process.env["OPENCODE_EXPERIMENTAL_SANDBOX"]
    const raw = cfg.experimental?.sandbox
    const home = Filesystem.resolve(Global.Path.home)
    const tmp = Filesystem.resolve(os.tmpdir())
    const temp = Filesystem.contains(tmp, home) ? [] : [tmp]
    const requested = env === undefined ? raw?.enabled === true : Flag.OPENCODE_EXPERIMENTAL_SANDBOX
    const out = plan({
      requested,
      platform: process.platform,
      available: Boolean(Filesystem.stat(bin)?.size),
      cwd: Filesystem.resolve(input.cwd),
      project_root: Filesystem.resolve(input.project_root),
      worktree_root: Filesystem.resolve(input.worktree_root),
      home,
      opencode_roots: [Global.Path.data, Global.Path.config, Global.Path.state, Global.Path.cache].map(
        Filesystem.resolve,
      ),
      extra_read_roots: [...(raw?.extra_read_roots ?? []), ...temp].map(Filesystem.resolve),
      extra_write_roots: [...(raw?.extra_write_roots ?? []), ...temp].map(Filesystem.resolve),
      allow_network: input.allow_network,
      allow_unix_sockets: input.allow_unix_sockets,
    })

    if (out.active) log.debug("sandbox active", out.diag)
    else if (out.diag.requested) log.info("sandbox inactive", out.diag)
    else log.debug("sandbox disabled", out.diag)

    return out
  }
}
