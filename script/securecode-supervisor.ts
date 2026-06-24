#!/usr/bin/env bun
/**
 * SecureCode Sandbox Supervisor (Phase 0)
 *
 * sandbox 外で動作する launcher。
 * - 設定ファイルを読み込み (global: ~/.config/securecode/sandbox.json, project: ./.securecode/sandbox.json)
 * - @anthropic-ai/sandbox-runtime を初期化
 * - opencode 本体を sandbox 内で spawn
 *
 * 設計方針は .specs/20260526_securecode-sandbox-phase0.md を参照。
 */

import { SandboxManager, type SandboxRuntimeConfig } from "@anthropic-ai/sandbox-runtime"
import { spawn, spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  watch,
  writeFileSync,
} from "node:fs"
import { homedir, tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"

export const CONFIG_DIR = join(homedir(), ".config", "securecode")
export const CONFIG_PATH = join(CONFIG_DIR, "sandbox.json")

export const DEFAULT_ALLOWED_DOMAINS = ["conf-ai.acompany-az.com"]

/**
 * supervisor が TUI と「sandbox.json の hash」を受け渡すための runtime dir のベース。
 * 実体は `${RUNTIME_DIR_BASE}/<supervisor_pid>` に作る (同時起動への配慮)。
 */
export const RUNTIME_DIR_BASE = join(homedir(), ".cache", "securecode", "runtime")

/**
 * 子プロセス (TUI) が「reload してほしい」を supervisor に伝えるための専用 exit code。
 * 75 = `EX_TEMPFAIL` (sysexits.h)。SecureCode では「一時的な状態で、再試行 (= reload) で
 * 解決する」というセマンティクスにフィットする。
 */
export const RELOAD_EXIT_CODE = 75

/**
 * 子プロセスが runtime dir のパスを知るための環境変数名。
 * TUI plugin (`sandbox-reload`) がこの env から hash file を発見する。
 */
export const SANDBOX_HASH_DIR_ENV = "SECURECODE_SANDBOX_HASH_DIR"

/**
 * RELOAD_EXIT_CODE の値を子プロセスに伝える env 名。
 * TUI 側で `parseInt(env)` して使う (定数の二重管理を避けるため)。
 */
export const RELOAD_EXIT_CODE_ENV = "SECURECODE_RELOAD_EXIT_CODE"

/**
 * reload 後の起動で「前回 reload が失敗した理由」を TUI に伝える env 名。
 * 値が空文字でない場合、TUI plugin が toast.error で表示する。
 */
export const RELOAD_ERROR_ENV = "SECURECODE_RELOAD_ERROR"

export const BASELINE_HASH_FILENAME = "baseline-hash"
export const CURRENT_HASH_FILENAME = "current-hash"

// securecode 本体 (= sandbox 内で動く inner binary。upstream の packages/core/src/global.ts
// 由来) は `xdg-basedir` 経由で XDG ディレクトリ配下に "securecode" サブディレクトリを
// 掘って DB / cache / log / lock / tmp を書く。supervisor は本体より前に立ち上がるため
// core への import 依存は持てない。ここでは inner と同じ XDG 解決ロジックを最小実装で
// 再現する:
// - 環境変数が truthy ならそれを採用 (inner の `xdg-basedir` も `env || fallback`)。
//   相対パスは sandbox-runtime に渡せる絶対パスへ `resolve()` で正規化する。inner 側の
//   `path.join(v, app)` も同じ cwd 起点で解決されるため drift しない
// - 空文字 / 未設定なら spec 標準のフォールバック (~/.local/share 等)
const XDG_APP = "securecode"

function xdgPath(envVar: string, fallback: string): string {
  const v = process.env[envVar]
  if (!v) return fallback
  // inner (xdg-basedir) は truthy 値をそのまま採用する。supervisor もそれに合わせるが、
  // sandbox-runtime の allowWrite/denyWrite は絶対パス前提なので、相対パスはここで
  // process.cwd() 基準に解決して絶対化する。
  return resolve(v)
}

/**
 * sandbox `allowWrite` の組み込みベースライン。
 *
 * 「ユーザが何も書かなくても cwd と securecode の内部パスだけは書ける」状態を
 * 構造的に保証する。`buildSandboxConfig` 内で常に user 指定の **前** に
 * concat されるため、ユーザは「これに追加で開けたい場所」を `allowWrite` に
 * 書けば良い (= cwd は消えない)。
 *
 * 含まれるパス:
 * - **cwd** — ユーザがその場で開発する作業ディレクトリ
 * - **$XDG_DATA_HOME/securecode** — DB / snapshot / log / repos
 * - **$XDG_CACHE_HOME/securecode** — ripgrep / LSP バイナリ / skill キャッシュ
 * - **$XDG_CONFIG_HOME/securecode** — securecode 設定 (`sandbox.json` 自身は
 *   `buildSandboxConfig` 内で `denyWrite` 側に常時固定されており別途封鎖)
 * - **$XDG_STATE_HOME/securecode** — flock
 * - **per-session tmp** — `setupSessionTmpdir` で確保した `$TMPDIR/securecode-<ts>-<pid>/`。
 *   ここを baseline に入れ、かつ `process.env.TMPDIR` を上書きして子に渡すことで、
 *   sandbox 内 (securecode-bin) の `os.tmpdir()` 呼び出し (JDTLS / TUI clipboard /
 *   TUI external editor / Global.Path.tmp など) が全部このディレクトリ配下に閉じる。
 *   別セッションの残骸を読み書きできない設計。
 *
 * cwd を逆に塞ぎたい上級ケースは `denyWrite: ["./"]` で対処可能 (deny が勝つ)。
 *
 * @param opts.cwd - 作業ディレクトリ。テストから注入する用途で引数化している。
 * @param opts.tmp - per-session tmp の絶対パス。未指定なら `$TMPDIR/securecode`
 *   (= securecode 内の `Global.Path.tmp` 相当) にフォールバックするが、本番経路は
 *   `setupSessionTmpdir()` の戻り値を必ず渡す。
 */
export function defaultAllowWrite(opts: { cwd?: string; tmp?: string } = {}): string[] {
  const cwd = opts.cwd ?? process.cwd()
  const tmp = opts.tmp ?? join(tmpdir(), XDG_APP)
  const home = homedir()
  return [
    cwd,
    join(xdgPath("XDG_DATA_HOME", join(home, ".local", "share")), XDG_APP),
    join(xdgPath("XDG_CACHE_HOME", join(home, ".cache")), XDG_APP),
    join(xdgPath("XDG_CONFIG_HOME", join(home, ".config")), XDG_APP),
    join(xdgPath("XDG_STATE_HOME", join(home, ".local", "state")), XDG_APP),
    tmp,
  ]
}

/**
 * supervisor 起動時に **per-session の TMPDIR override** を確保する。
 *
 * `$TMPDIR/securecode-<ts>-<pid>/` を作成し、戻り値 `path` を返す。呼び出し側は:
 * 1. `process.env.TMPDIR = path` を設定して子 (securecode-bin) に継承させる
 *    → Node の `os.tmpdir()` は `TMPDIR` を直接参照するため、upstream 側の改造ゼロで
 *      sandbox 内の全 tmp 利用箇所がこのディレクトリ配下に閉じる
 *    → 結果: 別セッションの残骸を AI が読めない / 自分の残骸も他セッションに見られない
 * 2. `buildSandboxConfig` に `tmp: path` で渡して baseline に含める
 * 3. securecode-bin 終了後に `cleanup()` で `rm -rf` する
 *
 * **suffix の構成**: `<Date.now()>-<process.pid>`。
 * - **timestamp (ms)** がクロス時間方向のユニーク性を担当: PID 再利用や cleanup 取りこぼし
 *   による「過去セッションの残骸と衝突する」問題を構造的に消す (時刻は単調増加するため、
 *   古い dir 名と新セッションの dir 名は必ず異なる)。
 * - **PID** が並行方向のユニーク性を担当: 同一 ms 内に並行起動した supervisor が同じ dir
 *   名になるのを防ぐ (OS は同時に生きている 2 プロセスに同一 PID を割り当てないため)。
 * - 結果として乱数を一切使わず構造的に衝突不可になる。両者ともデバッグ可読性も高い
 *   (`いつ` 起動 / `誰が` 起動 が dir 名から即わかる)。
 *
 * **クラッシュ時の挙動**: supervisor が SIGKILL / panic で落ちると cleanup が呼ばれず
 * ゴミディレクトリが残る。次回起動時に自動掃除はしない (古い `securecode-XXX`
 * ディレクトリが現役の別 supervisor のものかを安全に判定するのが面倒なため)。
 * 気になればユーザが手動 rm。
 *
 * @param opts.base - parent ディレクトリ。未指定なら現在の `os.tmpdir()`。テストから注入用。
 * @param opts.suffix - ディレクトリ名の suffix (`securecode-<suffix>`)。未指定なら
 *   `<timestamp>-<pid>` を生成。テストから決定論的なパスを指定する用途。
 */
export function setupSessionTmpdir(
  opts: { base?: string; suffix?: string } = {},
): { path: string; cleanup: () => void } {
  // macOS の os.tmpdir() は `/var/folders/...` を返すが、`/var` は `/private/var` への
  // symlink で実体は `/private/var/folders/...`。Seatbelt は canonical path で評価する
  // ため、allowWrite に登録するパスと sandbox 内のプロセスが書き込もうとするパスが
  // canonical 一致していないと write が拒否される (= JDTLS / TUI external editor / clipboard
  // が壊れる)。`realpathSync` で確実に canonical path へ展開してから組み立てる。
  // (Linux でも一般に同等。base が symlink を含まないシステムでは no-op。)
  const base = realpathSync(opts.base ?? tmpdir())
  const suffix = opts.suffix ?? `${Date.now()}-${process.pid}`
  const path = join(base, `securecode-${suffix}`)
  mkdirSync(path, { recursive: true })
  return {
    path,
    cleanup: () => {
      try {
        rmSync(path, { recursive: true, force: true })
      } catch {
        // cleanup は best-effort: 既に削除済み / 別プロセスが触ってる等で失敗しても
        // supervisor の終了経路をブロックしない。
      }
    },
  }
}

/**
 * 全フィールドが `string[]` 必須に揃った正規化済み config。
 *
 * `loadUserConfig` を通れば必ずこの形になるため、`mergeUserConfigs` や
 * `buildSandboxConfig` のような後段では `?? []` のような undefined ガードを
 * 書かなくて済む (= 条件分岐が消える)。
 */
export type UserConfig = {
  network: {
    allowedDomains: string[]
    deniedDomains: string[]
  }
  filesystem: {
    allowRead: string[]
    allowWrite: string[]
    denyRead: string[]
    denyWrite: string[]
  }
}

// sandbox.json の JSON parse 結果を受ける internal な型 (export しない)。
// 「ユーザがキーを書き忘れる」を吸収するため、全て optional。境界変換は
// 直下の `loadUserConfig` 内でのみ起きる。
type RawUserConfig = {
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

/**
 * verbose な進捗ログ。reload 経路で出すと、再 spawn 直前 (旧 TUI が alternate
 * screen から抜けた直後) に端末へドカドカ流れて見苦しい。デフォルトは silent、
 * `SECURECODE_SUPERVISOR_DEBUG=1` のときだけ stderr に出す。
 *
 * エラー (`failed to ...` 等) は常に `log` 経由で出す。
 */
function debugLog(msg: string): void {
  if (process.env["SECURECODE_SUPERVISOR_DEBUG"] === "1") log(msg)
}

// fatal error 用の専用クラス。`die()` から throw され、top-level catch がここで
// exit code を拾って `process.exit(code)` する。Error をそのまま使うと top-level の
// 一般的な catch (unexpected error → exit 1) と区別できないため別クラスにする。
class FatalError extends Error {
  constructor(
    msg: string,
    readonly code: number = 1,
  ) {
    super(msg)
    this.name = "FatalError"
  }
}

// 致命エラー時の中断。`process.exit` を直接呼ぶと `try/finally` の cleanup を skip
// するため、必ず throw 経由にして `main()` の outer try/finally → top-level catch
// で集約的に exit する。`never` を返す型は維持しているので呼び出し側の制御フローは
// 変わらない (= `die(...)` の後は unreachable)。
function die(msg: string, code = 1): never {
  throw new FatalError(msg, code)
}

/**
 * 1 個のユーザ設定ファイルを読み込み、正規化済みの `UserConfig` で返す
 * (global / project どちらでも同じ実装で良い)。
 *
 * ファイル不在は正常系として扱い、全フィールド `[]` の空 config を返す。
 * JSON parse 失敗のみ fatal error。
 *
 * @param path - 設定ファイルの絶対パス。テストから注入する用途で引数化している。
 * @throws `die()` 経由で `process.exit(1)`。読み込み or JSON parse 失敗時のみ。
 */
export function loadUserConfig(path: string = CONFIG_PATH): UserConfig {
  let raw: RawUserConfig = {}
  if (!existsSync(path)) {
    log(`no user config at ${path}, using defaults`)
  } else {
    try {
      raw = JSON.parse(readFileSync(path, "utf8")) as RawUserConfig
    } catch (err) {
      die(`failed to read/parse ${path}: ${(err as Error).message}`)
    }
  }
  // 境界変換: 欠落キーをすべて `[]` 埋めして以降のコードから undefined ガードを消す。
  return {
    network: {
      allowedDomains: raw.network?.allowedDomains ?? [],
      deniedDomains: raw.network?.deniedDomains ?? [],
    },
    filesystem: {
      allowRead: raw.filesystem?.allowRead ?? [],
      allowWrite: raw.filesystem?.allowWrite ?? [],
      denyRead: raw.filesystem?.denyRead ?? [],
      denyWrite: raw.filesystem?.denyWrite ?? [],
    },
  }
}

/**
 * 複数の `UserConfig` を 1 つに合成する。allow / deny いずれも単純な配列 concat
 * (重複除去はしない — sandbox-runtime に重複を渡しても Seatbelt の regex も
 * bwrap の bind も冪等なので無害)。
 *
 * 「deny を優先する」ニュアンスは「片方でも deny に入っていれば deny される」
 * という形で満たされる (allow と deny に同じ値が入っていても sandbox-runtime
 * 側で deny が勝つ前提)。
 */
export function mergeUserConfigs(...configs: UserConfig[]): UserConfig {
  return {
    network: {
      allowedDomains: configs.flatMap((c) => c.network.allowedDomains),
      deniedDomains: configs.flatMap((c) => c.network.deniedDomains),
    },
    filesystem: {
      allowRead: configs.flatMap((c) => c.filesystem.allowRead),
      allowWrite: configs.flatMap((c) => c.filesystem.allowWrite),
      denyRead: configs.flatMap((c) => c.filesystem.denyRead),
      denyWrite: configs.flatMap((c) => c.filesystem.denyWrite),
    },
  }
}

/**
 * 空入力からなる正規化済みの `UserConfig`。
 *
 * `tryLoadUserConfig` がファイル不在を成功扱いするときの戻り値や、テストの
 * fixture でゼロ値が必要なときに使う。
 */
export function emptyUserConfig(): UserConfig {
  return {
    network: { allowedDomains: [], deniedDomains: [] },
    filesystem: { allowRead: [], allowWrite: [], denyRead: [], denyWrite: [] },
  }
}

/**
 * `loadUserConfig` の non-fatal 版。reload 時に呼ぶ。parse 失敗を例外ではなく
 * Result 型として返すことで、supervisor は旧 config を維持したまま「reload 失敗」
 * を子プロセス側に伝えられる。正規化ロジックは `loadUserConfig` と完全に同じ。
 */
export function tryLoadUserConfig(
  path: string = CONFIG_PATH,
): { ok: true; value: UserConfig } | { ok: false; error: string } {
  if (!existsSync(path)) return { ok: true, value: emptyUserConfig() }
  let raw: RawUserConfig
  try {
    raw = JSON.parse(readFileSync(path, "utf8")) as RawUserConfig
  } catch (err) {
    return { ok: false, error: (err as Error).message }
  }
  return {
    ok: true,
    value: {
      network: {
        allowedDomains: raw.network?.allowedDomains ?? [],
        deniedDomains: raw.network?.deniedDomains ?? [],
      },
      filesystem: {
        allowRead: raw.filesystem?.allowRead ?? [],
        allowWrite: raw.filesystem?.allowWrite ?? [],
        denyRead: raw.filesystem?.denyRead ?? [],
        denyWrite: raw.filesystem?.denyWrite ?? [],
      },
    },
  }
}

/**
 * 複数の sandbox.json ファイルを **まとめて** 1 個の SHA-256 hex に畳む。
 *
 * 「global と project の両方が監視対象」のため、reload の検知は「いずれかの
 * ファイルが変わったか」を 1 個のハッシュで表現する形に揃える。
 *
 * - ファイル不在 → `absent\0` を含める。「不在」と「ある」を区別できる
 * - 読み取り失敗 → `error:<msg>\0` を含める
 * - パス自体もハッシュに含める (順序入れ替えで hash が変わるのは設計通り)
 */
export function computeSandboxConfigHash(paths: string[] = [CONFIG_PATH]): string {
  const h = createHash("sha256")
  for (const path of paths) {
    h.update(`path:${path}\0`)
    if (!existsSync(path)) {
      h.update("absent\0")
      continue
    }
    try {
      h.update("file:")
      h.update(readFileSync(path))
      h.update("\0")
    } catch (err) {
      h.update(`error:${(err as Error).message}\0`)
    }
  }
  return h.digest("hex")
}

/**
 * supervisor 用の runtime dir (`${RUNTIME_DIR_BASE}/<pid>`) を作成して path を返す。
 * 同名のディレクトリが残骸として残っていた場合は中身を削除して作り直す。
 */
export function prepareRuntimeDir(pid: number = process.pid, base: string = RUNTIME_DIR_BASE): string {
  const dir = join(base, String(pid))
  if (existsSync(dir)) rmSync(dir, { recursive: true, force: true })
  mkdirSync(dir, { recursive: true })
  return dir
}

function defaultIsAlive(pid: number): boolean {
  try {
    // signal 0 は実送信せず存在確認だけ行う POSIX の慣用句。
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

/**
 * 過去の supervisor が SIGKILL 等で即死した場合に残る stale runtime dir を掃除する。
 * dir 名 (= pid) のプロセスがもう生きていなければ削除する。
 */
export function cleanupStaleRuntimeDirs(
  base: string = RUNTIME_DIR_BASE,
  isAlive: (pid: number) => boolean = defaultIsAlive,
): void {
  if (!existsSync(base)) return
  let entries: string[]
  try {
    entries = readdirSync(base)
  } catch {
    return
  }
  for (const name of entries) {
    const pid = Number.parseInt(name, 10)
    if (!Number.isInteger(pid) || pid <= 0 || String(pid) !== name) continue
    if (pid === process.pid || isAlive(pid)) continue
    try {
      rmSync(join(base, name), { recursive: true, force: true })
    } catch {
      // 消せない残骸は放置 (次回起動時にまた試す)
    }
  }
}

/**
 * 端末を usable な状態に復旧する。TUI が renderer cleanup なしに `process.exit(75)`
 * で即死した直後、再 spawn せず supervisor 自身が死ぬ経路 (sandbox 再 init 失敗) で
 * 端末が alternate screen / raw mode のままになるのを防ぐ。
 */
export function resetTerminal(out: NodeJS.WriteStream = process.stdout): void {
  // alternate screen 離脱 / カーソル再表示 / 文字属性リセット
  out.write("\x1b[?1049l\x1b[?25h\x1b[0m")
  // raw mode (termios) は escape sequence では戻せないので stty に頼る。
  if (process.stdin.isTTY) {
    try {
      spawnSync("stty", ["sane"], { stdio: ["inherit", "ignore", "ignore"] })
    } catch {
      // stty が無い環境では escape sequence だけで妥協する
    }
  }
}

/**
 * ハッシュ文字列を atomic に書き込む (temp file + rename)。
 * `fs.watch` がエディタの atomic write を観測するのと同じ理由。
 */
export function writeHashFile(target: string, hash: string): void {
  const tmp = `${target}.tmp`
  writeFileSync(tmp, hash)
  renameSync(tmp, target)
}

/**
 * sandbox.json (global + project) を fs.watch で監視し、いずれかの変更を debounce
 * してから combined hash を current-hash ファイルへ書き出す。
 *
 * 同じ親 dir のパスは 1 個の watcher にまとめる (= 重複監視を避ける)。
 */
export function startSandboxConfigWatcher(opts: {
  configPaths: string[]
  currentHashFile: string
  debounceMs?: number
}): () => void {
  const debounceMs = opts.debounceMs ?? 200
  let timer: ReturnType<typeof setTimeout> | undefined

  const handle = () => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      const hash = computeSandboxConfigHash(opts.configPaths)
      try {
        writeHashFile(opts.currentHashFile, hash)
      } catch (err) {
        log(`failed to write current hash: ${(err as Error).message}`)
      }
    }, debounceMs)
  }

  // 親 dir ごとに 1 個の watcher にまとめる。
  const targetsByDir = new Map<string, Set<string>>()
  for (const p of opts.configPaths) {
    const dir = dirname(p)
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    const targets = targetsByDir.get(dir) ?? new Set<string>()
    targets.add(p.slice(dir.length + 1))
    targetsByDir.set(dir, targets)
  }

  const watchers: ReturnType<typeof watch>[] = []
  for (const [dir, targets] of targetsByDir) {
    const w = watch(dir, (_event, name) => {
      // name は OS によって null/undefined になり得る。null の時も発火させる
      // (atomic rename の最終 event で name が落ちることがある)。
      if (name && !targets.has(name)) return
      handle()
    })
    // FSWatcher の 'error' イベントに何も付けないと、dir が消えた瞬間に
    // uncaughtException で supervisor が死ぬ。fatal ではないので log だけ出す。
    w.on("error", (err) => log(`config watcher error: ${err.message}`))
    watchers.push(w)
  }

  return () => {
    if (timer) clearTimeout(timer)
    for (const w of watchers) w.close()
  }
}

/**
 * reload 後に子プロセスを再 spawn するための引数列を組み立てる純関数。
 *
 * - `--prompt <値>` / `--prompt=<値>` は除去 (初期プロンプトを再送しない)
 * - セッション指定 (`--continue` / `-c` / `--session` / `-s`) が無ければ `--continue` を付与
 */
export function buildRespawnArgs(baseArgs: string[]): string[] {
  const args: string[] = []
  for (let i = 0; i < baseArgs.length; i++) {
    const a = baseArgs[i]!
    if (a === "--prompt") {
      i++ // 直後の値も読み飛ばす
      continue
    }
    if (a.startsWith("--prompt=")) continue
    args.push(a)
  }
  const hasSessionFlag = args.some(
    (a) => a === "--continue" || a === "-c" || a === "--session" || a === "-s" || a.startsWith("--session="),
  )
  if (!hasSessionFlag) args.push("--continue")
  return args
}

/**
 * reload の 1 イテレーション分の決定論的な核を切り出した純関数。
 * 失敗時は旧 config を保持し、エラーだけを伝える (フェイルセーフ)。
 */
export function resolveReload(input: {
  prevConfig: UserConfig
  prevHash: string
  loadResult: { ok: true; value: UserConfig } | { ok: false; error: string }
  newHash: string
}): { nextConfig: UserConfig; nextHash: string; error?: string } {
  if (input.loadResult.ok) {
    return { nextConfig: input.loadResult.value, nextHash: input.newHash }
  }
  return { nextConfig: input.prevConfig, nextHash: input.prevHash, error: input.loadResult.error }
}

/**
 * global + project の両方を non-fatal に読み込み、merge した正規化 UserConfig を返す。
 * どちらか 1 つでも parse に失敗したら旧 config 維持できるよう `{ ok: false, error }` を返す。
 */
function loadAndMergeAllUserConfigs(
  paths: string[],
): { ok: true; value: UserConfig } | { ok: false; error: string } {
  const configs: UserConfig[] = []
  for (const p of paths) {
    const r = tryLoadUserConfig(p)
    if (!r.ok) return { ok: false, error: `${p}: ${r.error}` }
    configs.push(r.value)
  }
  return { ok: true, value: mergeUserConfigs(...configs) }
}

/**
 * `UserConfig` を sandbox-runtime に渡す `SandboxRuntimeConfig` に変換する。
 *
 * 合成ルール:
 * - `allowedDomains` — `DEFAULT_ALLOWED_DOMAINS` (CIA endpoint) を常に先頭に固定し、
 *   user 値を後ろに append する。user 設定で CIA を削除することはできない。
 * - `denyRead` / `denyWrite` — `opts.configPaths` (デフォルトは global の `CONFIG_PATH` のみ) を
 *   常に先頭に追加し、sandbox 内のプロセスから設定ファイルの読み書きを物理的に封鎖する。
 *   per-directory の `./.securecode/sandbox.json` を有効化する呼び出し側は、ここに project
 *   側のパスも含めて渡すこと。
 * - `allowWrite` — `defaultAllowWrite(cwd)` のベースライン (cwd + opencode の XDG 配下 + tmp)
 *   を常に先頭に concat し、user 指定分はその後ろに **追加**される (加算式)。
 *   ユーザは「cwd 以外で追加で開けたい場所」だけを `allowWrite` に書けば良い。
 *   cwd を逆に塞ぎたい上級ケースは `denyWrite: ["./"]` で対処可能 (deny が勝つ)。
 * - `denyWrite` — `opts.runtimeDir` が指定されていれば末尾に追加する。AI が偽 hash を
 *   書いて reload を誘発する経路を物理的に封鎖する。
 * - `allowRead` — user が allowlist mode で指定している場合のみ `opts.runtimeDir` を append。
 *   未指定 (= 全許可) なら何もしない (= TUI plugin はそのまま読める)。
 * - `allowPty` / `network.allowLocalBinding` — 常に `true` (TUI と dev server のため)。
 *
 * @param user - ユーザ設定。空オブジェクト `{}` も有効入力。
 * @param opts.configPaths - 常時 deny に追加する設定ファイルパス。未指定なら `[CONFIG_PATH]`。
 * @param opts.cwd - `defaultAllowWrite` に渡す cwd。未指定なら `process.cwd()`。
 * @param opts.tmp - `defaultAllowWrite` に渡す per-session tmp。
 * @param opts.runtimeDir - supervisor が TUI と hash を受け渡すための runtime dir。指定すると
 *        denyWrite に append され、user の allowRead が allowlist mode の場合は allowRead にも append。
 * @returns `SandboxManager.initialize()` にそのまま渡せる完全な config。
 */
export function buildSandboxConfig(
  user: UserConfig,
  opts: { configPaths?: string[]; cwd?: string; tmp?: string; runtimeDir?: string } = {},
): SandboxRuntimeConfig {
  const allowedDomains = [...DEFAULT_ALLOWED_DOMAINS, ...user.network.allowedDomains]

  // SecureCode 本体が sandbox 設定ファイル (global + project) に読み書き一切できないよう
  // 物理的に封鎖する。
  // ※ ディレクトリ全体は deny にしない。opencode 本体も同じ ~/.config/securecode/
  // 配下に config.json を持つため、ディレクトリごと封鎖すると opencode が起動できない。
  // ファイル単位 denyWrite なら unlink+再作成も Seatbelt/bwrap が阻止するので、
  // 改竄不可の保証は維持される。
  const configPaths = opts.configPaths ?? [CONFIG_PATH]
  const denyRead = [...configPaths, ...user.filesystem.denyRead]
  const denyWrite = [...configPaths, ...user.filesystem.denyWrite]
  if (opts.runtimeDir) denyWrite.push(opts.runtimeDir)

  // allowWrite は加算式: ベースライン (cwd + opencode XDG 配下 + per-session tmp) を
  // 常に先頭に置き、ユーザ指定はそれに追加される。これにより「ユーザが allowWrite を
  // 1 つでも書いた瞬間に cwd が消える」 footgun を構造的に排除している。
  const allowWrite = [...defaultAllowWrite({ cwd: opts.cwd, tmp: opts.tmp }), ...user.filesystem.allowWrite]
  // allowRead は undefined を渡すと sandbox-runtime の デフォルト read 挙動 (= 全許可)
  // に委ねられる。user が allowlist mode を指定している場合のみ、runtime dir を追加で
  // 許可しないと TUI plugin が hash file を読めなくなる。
  const baseAllowRead = user.filesystem.allowRead.length > 0 ? user.filesystem.allowRead : undefined
  const allowRead = baseAllowRead && opts.runtimeDir ? [...baseAllowRead, opts.runtimeDir] : baseAllowRead

  return {
    network: {
      allowedDomains,
      deniedDomains: user.network.deniedDomains,
      // localhost への bind / listen は egress 制御とは直交（最終的な outbound は
      // 別途 proxy + allowedDomains でチェックされるため抜け道にならない）。
      // dev server 起動や子プロセス間 IPC を許可するため true にする。
      allowLocalBinding: true,
    },
    filesystem: {
      denyRead,
      allowRead,
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

async function main(): Promise<number> {
  await assertSandboxAvailable()

  // per-session tmp を確保し、子に渡す env.TMPDIR を上書きする。これにより sandbox 内
  // (securecode-bin) の全 os.tmpdir() 呼び出し (JDTLS / TUI clipboard / external editor /
  // Global.Path.tmp) がこのディレクトリ配下に閉じ、別セッションの残骸を読み書きできない
  // 設計になる。baseline (defaultAllowWrite) にも同じパスを渡し、sandbox の allowWrite に含める。
  //
  // 確保は signal handler 登録より前に済ませる: handler から `session` を参照するため。
  const session = setupSessionTmpdir()
  process.env.TMPDIR = session.path

  // sandbox.json は global (~/.config/securecode/) と project (cwd/.securecode/) の 2 階層。
  // 親ディレクトリへの walk は意図的にしない (攻撃面 / 暗黙の上位設定を避ける)。
  //
  // cwd は **canonical path** に展開する: macOS の `os.tmpdir()` (`/var/folders/...`) や
  // ユーザが symlink 配下 (例: `/tmp/myproj` (= `/private/tmp/myproj`)) で開発するケースで、
  // Seatbelt は canonical path で allow/deny を評価するため、logical path のまま allowWrite に
  // 載せると sandbox 内の write が全て拒否される。同じ理由で setupSessionTmpdir も
  // base を realpath している。`projectConfigPath` も canonical 起点で組み立てて denyRead/
  // denyWrite に渡すパスを sandbox 評価軸と一致させる。
  const cwd = realpathSync(process.cwd())
  const projectConfigPath = join(cwd, ".securecode", "sandbox.json")
  const configPaths = [CONFIG_PATH, projectConfigPath]

  // TUI plugin と hash を受け渡すための runtime dir。session と同じく try/finally 内で
  // cleanup する。前回 SIGKILL 等で残った dir もここで掃除する。
  cleanupStaleRuntimeDirs()
  const runtimeDir = prepareRuntimeDir()
  const baselineHashFile = join(runtimeDir, BASELINE_HASH_FILENAME)
  const currentHashFile = join(runtimeDir, CURRENT_HASH_FILENAME)
  const cleanupRuntime = () => {
    try {
      rmSync(runtimeDir, { recursive: true, force: true })
    } catch {
      // 削除失敗は無視 (次回起動時に prepareRuntimeDir が作り直す)
    }
  }

  // 以降は try/finally で囲み、どの経路 (正常 exit / 同期 throw / SandboxManager 初期化失敗 /
  // wrapWithSandbox throw 等) でも session.cleanup と cleanupRuntime が確実に走るようにする。
  // `process.exit` は finally を skip するため、本関数では exit code を return するに留め、
  // 実 exit は呼び出し側に集約する。
  try {
    // Ctrl+C や SIGTERM は process group 全体に届くため、child (securecode-bin) も同じ
    // signal を受けて自分で終了する。本来 parent は child の exit を待つだけで済むが、
    //
    // 1. parent の default SIGINT/SIGTERM handler は **即 process.exit()** してしまい、
    //    finally の cleanup を skip する。これがないと per-session tmpdir / runtime dir が
    //    /tmp や ~/.cache 配下に溜まる。
    // 2. child が signal を握りつぶす状態 (TUI が一時的に handler 差し替え中 / JDTLS が
    //    停止しない 等) になると、parent も自分で終了できず永久ハングする。
    //
    // 対策: 1 回目は child へ明示的に signal を forward (parent は exit させない)、
    // 2 回目は「ユーザが本当に降りたい」とみなして cleanup を試みた後で強制 exit。
    let child: ReturnType<typeof spawn> | undefined
    let interruptCount = 0
    const forwardSignal = (sig: "SIGINT" | "SIGTERM") => () => {
      interruptCount++
      if (child && child.exitCode === null && !child.killed) {
        try {
          child.kill(sig)
        } catch {
          // kill は best-effort: 既に死んでる / EPERM 等は無視。
        }
      }
      if (interruptCount >= 2) {
        // 2 回目以降は強制脱出。process.exit は finally を skip するため、
        // cleanup だけはここで明示的に試みる。
        try {
          session.cleanup()
        } catch {
          // ignore
        }
        cleanupRuntime()
        // 128 + signal number 慣例: SIGINT=130, SIGTERM=143
        process.exit(sig === "SIGINT" ? 130 : 143)
      }
    }
    process.on("SIGINT", forwardSignal("SIGINT"))
    process.on("SIGTERM", forwardSignal("SIGTERM"))

    // 起動時は strict (process.exit on parse error)。reload 時は non-fatal な
    // tryLoadUserConfig を使うので、ここだけ loadUserConfig を直接呼ぶ。
    let userConfig = mergeUserConfigs(loadUserConfig(CONFIG_PATH), loadUserConfig(projectConfigPath))
    let baselineHash = computeSandboxConfigHash(configPaths)
    writeHashFile(baselineHashFile, baselineHash)
    writeHashFile(currentHashFile, baselineHash)

    let sandboxConfig = buildSandboxConfig(userConfig, {
      configPaths,
      cwd,
      tmp: session.path,
      runtimeDir,
    })

    log(`allowedDomains = ${sandboxConfig.network.allowedDomains.join(", ")}`)
    log(`session tmp = ${session.path}`)

    try {
      await SandboxManager.initialize(sandboxConfig)
    } catch (err) {
      die(`failed to initialize sandbox: ${(err as Error).message}`)
    }

    const stopWatcher = startSandboxConfigWatcher({
      configPaths,
      currentHashFile,
    })

    const baseArgs = process.argv.slice(2)
    let reloadError: string | undefined
    let iteration = 0

    try {
      while (true) {
        // 2 周目以降は前回セッションを継続する (--prompt は再送しない)。
        const args = iteration === 0 ? baseArgs : buildRespawnArgs(baseArgs)
        const inner = resolveInnerCommand(args)
        const wrapped = await SandboxManager.wrapWithSandbox(inner)

        // iter 0 (初回起動) は端末がまだ alternate screen に入っていないので普通に出す。
        // iter >= 1 (reload) は旧 TUI が抜けた直後の主画面に流れて見苦しいので silent。
        if (iteration === 0) log("launching opencode inside sandbox")
        else debugLog(`launching opencode inside sandbox (iter ${iteration})`)

        child = spawn(wrapped, {
          shell: true,
          stdio: "inherit",
          env: {
            ...process.env,
            [SANDBOX_HASH_DIR_ENV]: runtimeDir,
            [RELOAD_EXIT_CODE_ENV]: String(RELOAD_EXIT_CODE),
            // 前回 reload に失敗していたらこの起動でだけ伝える (起動後に env を消す手段は
            // 無いので、TUI plugin 側は「起動時に 1 度だけ読む」運用にする)。
            [RELOAD_ERROR_ENV]: reloadError ?? "",
          },
        })

        const exitCode: number = await new Promise((r) => {
          child!.on("exit", (code) => r(code ?? 1))
          child!.on("error", (err) => {
            log(`child error: ${err.message}`)
            r(1)
          })
        })

        if (exitCode !== RELOAD_EXIT_CODE) {
          await SandboxManager.reset().catch(() => {})
          return exitCode
        }

        debugLog("reload requested by TUI")
        reloadError = undefined

        // 新しい sandbox.json (global + project) を non-fatal に読み込む。
        // どちらかが parse 失敗していたら、旧 config を維持して error toast だけ伝える。
        const loadResult = loadAndMergeAllUserConfigs(configPaths)
        const newHash = computeSandboxConfigHash(configPaths)
        const reloaded = resolveReload({
          prevConfig: userConfig,
          prevHash: baselineHash,
          loadResult,
          newHash,
        })
        if (reloaded.error) {
          reloadError = `sandbox.json の parse に失敗しました (旧設定を維持): ${reloaded.error}`
          log(reloadError)
        }

        userConfig = reloaded.nextConfig
        baselineHash = reloaded.nextHash
        sandboxConfig = buildSandboxConfig(userConfig, {
          configPaths,
          cwd,
          tmp: session.path,
          runtimeDir,
        })
        writeHashFile(baselineHashFile, baselineHash)
        writeHashFile(currentHashFile, baselineHash)

        try {
          await SandboxManager.reset()
        } catch (err) {
          log(`SandboxManager.reset() failed: ${(err as Error).message} (続行)`)
        }
        try {
          await SandboxManager.initialize(sandboxConfig)
        } catch (err) {
          // 直前の TUI は process.exit(RELOAD_EXIT_CODE) で即死しており端末が
          // alternate screen / raw mode のまま。再 spawn せず die するので復旧してから終了。
          resetTerminal()
          die(`failed to re-initialize sandbox: ${(err as Error).message}`)
        }

        debugLog(`reloaded allowedDomains = ${sandboxConfig.network.allowedDomains.join(", ")}`)
        iteration++
      }
    } finally {
      stopWatcher()
    }
  } finally {
    session.cleanup()
    cleanupRuntime()
  }
}

if (import.meta.main) {
  main()
    .then((code) => process.exit(code))
    .catch((err) => {
      if (err instanceof FatalError) {
        log(`FATAL: ${err.message}`)
        process.exit(err.code)
      }
      log(`FATAL: unexpected error: ${(err as Error).message}`)
      process.exit(1)
    })
}
