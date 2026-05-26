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

/**
 * ユーザ設定ファイル (`~/.config/securecode/sandbox.json`) を読み込む。
 *
 * ファイル不在は正常系として扱い、空オブジェクトを返す (= 全フィールドが
 * デフォルト値で起動する)。JSON parse 失敗のみ fatal error。
 *
 * @param path - 設定ファイルの絶対パス。テストから注入する用途で引数化している。
 * @returns parse 済み UserConfig。ファイル不在時は `{}`。
 * @throws `die()` 経由で `process.exit(1)`。読み込み or JSON parse 失敗時のみ。
 */
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

/**
 * `UserConfig` を sandbox-runtime に渡す `SandboxRuntimeConfig` に変換する。
 *
 * 合成ルール:
 * - `allowedDomains` — `DEFAULT_ALLOWED_DOMAINS` (CIA endpoint) を常に先頭に固定し、
 *   user 値を後ろに append する。user 設定で CIA を削除することはできない。
 * - `denyRead` / `denyWrite` — `CONFIG_PATH` (sandbox.json 自身) を常に先頭に追加し、
 *   sandbox 内のプロセスから設定ファイルの読み書きを物理的に封鎖する。
 * - `allowWrite` — 未指定なら `["/"]` にフォールバック (= 書き込みは `denyWrite`
 *   側だけで制御する運用)。
 * - `allowPty` / `network.allowLocalBinding` — 常に `true` (TUI と dev server のため)。
 *
 * @param user - ユーザ設定。空オブジェクト `{}` も有効入力。
 * @returns `SandboxManager.initialize()` にそのまま渡せる完全な config。
 */
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

/**
 * sandbox-runtime が現環境で利用可能かを fail-closed で検証する。
 *
 * 以下の条件のいずれかを満たさなければ起動拒否する:
 * - プラットフォームが Linux または macOS であること
 * - sandbox-runtime の依存ツール (Linux なら bubblewrap 等) が満たされていること
 *
 * `deps.warnings` レベル (= 致命ではない不整合) は stderr に流して続行する。
 *
 * @throws `die()` 経由で `process.exit(1)`。sandbox 起動不能と判断した場合のみ。
 */
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

/**
 * POSIX shell の single-quote escape。`spawn(cmd, { shell: true })` に渡す
 * コマンド文字列を組み立てるためのヘルパ。
 *
 * single quote で囲むと `\`, `$`, `` ` ``, `!`, 改行 を含むあらゆる特殊文字が
 * literal として扱われる (POSIX shell の単一引用符の唯一の特性)。文字列中の
 * single quote だけは `'\''` で閉じ直し → escape → 再 open する。
 *
 * `JSON.stringify` ではダメな理由: double-quote 内では `$` `` ` `` `\` `!` が
 * 依然として shell の特殊文字として解釈され、`$HOME` 等が展開されてしまう。
 */
export function shellQuote(s: string): string {
  return `'${s.replace(/'/g, "'\\''")}'`
}

/**
 * sandbox 内で起動する opencode 本体のコマンド文字列を解決する。
 *
 * 解決優先順位:
 * 1. **テストモード** — `opts.distBinPath` が明示指定されたら、そのパスを使う
 *    (テスト時に inner binary を任意の場所に置けるようにするための注入口)。
 * 2. **配布バイナリ** — `process.execPath` (bun compile 後の supervisor 本体パス)
 *    または `import.meta.dir` の隣に `securecode-bin` が存在すれば、それを直接 spawn。
 * 3. **開発ツリーフォールバック** — どちらでも見つからなければ、リポジトリ
 *    ルートに移動して `bun run --cwd packages/opencode --conditions=browser src/index.ts`
 *    を組み立てる (= `bun run script/securecode-supervisor.ts` で起動した想定)。
 *
 * 引数 `args` は加工せず `shellQuote` (POSIX single-quote escape) でクオートして
 * pass-through する。これは `--version` 等のフラグを target dir として誤解釈
 * しないため、かつパス中の `$HOME` 等を shell が誤って展開しないため。
 *
 * @param args - opencode へそのまま渡す引数列。通常は `process.argv.slice(2)`。
 * @param opts.distBinPath - テスト用に inner binary の絶対パスを明示指定する。
 * @returns `spawn(cmd, { shell: true })` に渡せる shell コマンド文字列。
 */
export function resolveInnerCommand(args: string[], opts: { distBinPath?: string } = {}): string {
  // supervisor は args を加工せず opencode へ pass-through する。target dir の
  // 解釈は opencode 側に任せる (フラグや subcommand を誤って resolve しない)。
  // shell injection / 意図しない展開を防ぐため shellQuote を使う
  // (JSON.stringify は double-quote で `$HOME` 等を展開してしまうので不可)。
  const quotedArgs = args.map(shellQuote).join(" ")
  const inner = (bin: string) => (quotedArgs ? `${shellQuote(bin)} ${quotedArgs}` : shellQuote(bin))

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
  const quotedRoot = shellQuote(repoRoot)
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
