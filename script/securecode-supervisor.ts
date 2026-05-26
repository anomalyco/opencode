#!/usr/bin/env bun
/**
 * SecureCode Sandbox Supervisor (Phase 0)
 *
 * sandbox 外で動作する launcher。
 * - 設定ファイルを読み込み (~/.config/securecode/sandbox.json)
 * - @anthropic-ai/sandbox-runtime を初期化
 * - opencode 本体を sandbox 内で spawn
 *
 * 設計方針は .specs/20260526_securecode-sandbox-phase0.md を参照。
 */

import { SandboxManager, type SandboxRuntimeConfig } from "@anthropic-ai/sandbox-runtime"
import { spawn } from "node:child_process"
import { existsSync, readFileSync } from "node:fs"
import { homedir } from "node:os"
import { dirname, join, resolve } from "node:path"

export const CONFIG_DIR = join(homedir(), ".config", "securecode")
export const CONFIG_PATH = join(CONFIG_DIR, "sandbox.json")

export const DEFAULT_ALLOWED_DOMAINS = ["conf-ai.acompany-az.com"]

export type UserConfig = {
  network?: {
    allowedDomains?: string[]
    deniedDomains?: string[]
  }
  filesystem?: {
    denyRead?: string[]
    allowRead?: string[]
    allowWrite?: string[]
    denyWrite?: string[]
  }
}

function log(msg: string): void {
  process.stderr.write(`[securecode-supervisor] ${msg}\n`)
}

function die(msg: string, code = 1): never {
  log(`FATAL: ${msg}`)
  process.exit(code)
}

export function loadUserConfig(path: string = CONFIG_PATH): UserConfig {
  if (!existsSync(path)) {
    log(`no user config at ${path}, using defaults`)
    return {}
  }
  try {
    const raw = readFileSync(path, "utf8")
    return JSON.parse(raw) as UserConfig
  } catch (err) {
    die(`failed to read/parse ${path}: ${(err as Error).message}`)
  }
}

export function buildSandboxConfig(user: UserConfig): SandboxRuntimeConfig {
  const allowedDomains = [...DEFAULT_ALLOWED_DOMAINS, ...(user.network?.allowedDomains ?? [])]
  const deniedDomains = user.network?.deniedDomains ?? []

  // SecureCode 本体が sandbox 設定ファイルに読み書き一切できないよう物理的に封鎖する。
  // ※ ディレクトリ全体は deny にしない。opencode 本体も同じ ~/.config/securecode/
  // 配下に config.json を持つため、ディレクトリごと封鎖すると opencode が起動できない。
  // ファイル単位 denyWrite なら unlink+再作成も Seatbelt/bwrap が阻止するので、
  // 改竄不可の保証は維持される。
  const denyRead = [CONFIG_PATH, ...(user.filesystem?.denyRead ?? [])]
  const denyWrite = [CONFIG_PATH, ...(user.filesystem?.denyWrite ?? [])]

  const allowWrite =
    user.filesystem?.allowWrite && user.filesystem.allowWrite.length > 0 ? user.filesystem.allowWrite : ["/"]

  return {
    network: {
      allowedDomains,
      deniedDomains,
      // localhost への bind / listen は egress 制御とは直交（最終的な outbound は
      // 別途 proxy + allowedDomains でチェックされるため抜け道にならない）。
      // dev server 起動や子プロセス間 IPC を許可するため true にする。
      allowLocalBinding: true,
    },
    filesystem: {
      denyRead,
      allowRead: user.filesystem?.allowRead,
      allowWrite,
      denyWrite,
    },
    // opencode の TUI は bun-pty を使うため /dev/ptmx / /dev/ttys* へのアクセスが必須。
    allowPty: true,
  }
}

export async function assertSandboxAvailable(): Promise<void> {
  if (!SandboxManager.isSupportedPlatform()) {
    die(
      `sandbox-runtime does not support this platform (${process.platform}). SecureCode requires macOS or Linux.`,
    )
  }
  const deps = SandboxManager.checkDependencies()
  if (deps.errors.length > 0) {
    die(
      `sandbox-runtime dependencies are missing: ${deps.errors.join("; ")}. Install them before running SecureCode.`,
    )
  }
  for (const w of deps.warnings) {
    log(`dep warning: ${w}`)
  }
}

// 配布バイナリで supervisor の隣に置かれる opencode 本体の名前。
// release-securecode.ts がこの名前で配置する。
export const INNER_BIN_NAME = "securecode-bin"

export function resolveInnerCommand(args: string[], opts: { distBinPath?: string } = {}): string {
  // supervisor は args を加工せず opencode へ pass-through する。target dir の
  // 解釈は opencode 側に任せる (フラグや subcommand を誤って resolve しない)。
  const quotedArgs = args.map((a) => JSON.stringify(a)).join(" ")
  const inner = (bin: string) => (quotedArgs ? `${JSON.stringify(bin)} ${quotedArgs}` : JSON.stringify(bin))

  // テスト用に distBinPath が明示指定されたらそれだけ確認する。
  if (opts.distBinPath !== undefined) {
    if (existsSync(opts.distBinPath)) return inner(opts.distBinPath)
  } else {
    // 実行時:
    //   - bun compile された配布バイナリ → process.execPath が securecode 本体を指す
    //   - bun runtime (bun run script/...) → process.execPath は bun 自身。supervisor.ts
    //     の論理パスは import.meta.dir で取る。
    // 両方の dir 隣に securecode-bin がいれば配布モードと判定する。
    for (const dir of [dirname(process.execPath), import.meta.dir]) {
      const distBin = join(dir, INNER_BIN_NAME)
      if (existsSync(distBin)) return inner(distBin)
    }
  }

  // 開発ツリーフォールバック (script/securecode-supervisor.ts に居る前提): 親リポジトリの
  // packages/opencode を bun runtime で起動。
  const repoRoot = resolve(import.meta.dir, "..")
  const quotedRoot = JSON.stringify(repoRoot)
  const tail = quotedArgs ? ` ${quotedArgs}` : ""
  return `cd ${quotedRoot} && bun run --cwd packages/opencode --conditions=browser src/index.ts${tail}`
}

async function main(): Promise<void> {
  await assertSandboxAvailable()

  const userConfig = loadUserConfig()
  const sandboxConfig = buildSandboxConfig(userConfig)

  log(`allowedDomains = ${sandboxConfig.network.allowedDomains.join(", ")}`)

  try {
    await SandboxManager.initialize(sandboxConfig)
  } catch (err) {
    die(`failed to initialize sandbox: ${(err as Error).message}`)
  }

  const inner = resolveInnerCommand(process.argv.slice(2))
  const wrapped = await SandboxManager.wrapWithSandbox(inner)

  log(`launching opencode inside sandbox`)

  const child = spawn(wrapped, {
    shell: true,
    stdio: "inherit",
    env: process.env,
  })

  const exitCode: number = await new Promise((r) => {
    child.on("exit", (code) => r(code ?? 1))
    child.on("error", (err) => {
      log(`child error: ${err.message}`)
      r(1)
    })
  })

  await SandboxManager.reset().catch(() => {})
  process.exit(exitCode)
}

if (import.meta.main) {
  main().catch((err) => {
    die((err as Error).message)
  })
}
