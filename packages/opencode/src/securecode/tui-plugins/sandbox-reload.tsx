/** @jsxImportSource @opentui/solid */
// securecode sandbox-reload TUI plugin.
//
// 役割:
// 1. supervisor (sandbox 外) が監視している sandbox.json の hash 変更を検知して
//    トースト通知を出す (「設定が変わった。/reload_sandbox で反映できます」)
// 2. slash command `/reload_sandbox` を提供する
//    - hash が変わっていなければ何もしない。代わりに「このコマンドの意図」を
//      説明するダイアログを出す (TUI のチラつきを起こさない)
//    - hash が変わっていれば、専用 exit code でプロセスを終了する。
//      supervisor がそれを検知して、新しい sandbox config で再 init し
//      `--continue` でセッションを復元しながら TUI を再起動する。
//
// supervisor との通信:
// - env `SECURECODE_SANDBOX_HASH_DIR`: hash ファイルが置かれている dir
// - env `SECURECODE_RELOAD_EXIT_CODE`: reload を要求する exit code (defaults 75)
// - env `SECURECODE_RELOAD_ERROR`: 前回 reload が失敗した時のメッセージ (起動時 1 回 toast)
//
// supervisor から起動された TUI でなければ何もしない (= 素の `opencode` 互換)。
//
// 設計詳細: acompany-develop/securecode#360
import { readFileSync } from "node:fs"
import { join } from "node:path"
import type { TuiPlugin, TuiPluginApi, TuiPluginModule } from "@opencode-ai/plugin/tui"

/**
 * current-hash ファイルを polling する間隔 (ms)。
 *
 * fs.watch を使わない理由: macOS Seatbelt は `com.apple.FSEvents` (fseventsd への
 * mach-lookup) を許可しないため、sandbox 内で `fs.watch` を呼んでもイベントが一切
 * deliver されない (エラーも出ずに沈黙する)。runtime dir 配下のハッシュファイルは
 * 64 バイト程度なので、1 秒に 1 回 read する CPU/IO コストは無視できる。
 *
 * supervisor 側 (`startSandboxConfigWatcher`) は sandbox 外で動くので、そちらは
 * 引き続き `fs.watch` を使う。
 */
export const HASH_POLL_INTERVAL_MS = 1000

export const HASH_DIR_ENV = "SECURECODE_SANDBOX_HASH_DIR"
export const RELOAD_EXIT_CODE_ENV = "SECURECODE_RELOAD_EXIT_CODE"
export const RELOAD_ERROR_ENV = "SECURECODE_RELOAD_ERROR"
export const DEFAULT_RELOAD_EXIT_CODE = 75
export const BASELINE_HASH_FILENAME = "baseline-hash"
export const CURRENT_HASH_FILENAME = "current-hash"

export const SAME_HASH_DIALOG_MESSAGE =
  "サンドボックス設定に変更はありません。\n\n" +
  "このコマンドは ~/.config/securecode/sandbox.json (global) または " +
  "./.securecode/sandbox.json (project) を編集した後に実行することで、" +
  "現在のセッション (会話履歴・todo) を保ったまま新しい設定を反映するためのコマンドです。\n\n" +
  "許可ドメインの追加など sandbox.json を編集したあとに、もう一度実行してください。"

export const CHANGED_TOAST_MESSAGE = "/reload_sandbox を実行すると、現在のセッションを保ったまま反映します。"

/**
 * hash ファイルから内容 (trim 済み) を返す。読めなければ null。
 *
 * 「読めない」のは supervisor が異常終了した・runtime dir が削除された等。
 * その場合 reload は安全に no-op として扱う (= 触らぬ神に祟りなし)。
 */
export function readHashFile(path: string): string | null {
  try {
    return readFileSync(path, "utf8").trim()
  } catch {
    return null
  }
}

/**
 * env の RELOAD_EXIT_CODE を整数として解釈する。invalid なら default。
 */
export function resolveReloadExitCode(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env[RELOAD_EXIT_CODE_ENV]
  const n = raw ? Number.parseInt(raw, 10) : Number.NaN
  return Number.isFinite(n) ? n : DEFAULT_RELOAD_EXIT_CODE
}

/**
 * `/reload_sandbox` 実行時の決定論的な判定。副作用なしの純関数。
 *
 * @returns
 *   - `{ action: "noop_unavailable" }`: hash ファイルが読めない (supervisor 通信失敗)
 *   - `{ action: "noop_unchanged" }`: hash 同一。reload せず説明ダイアログだけ表示
 *   - `{ action: "reload" }`: hash 差分あり。RELOAD_EXIT_CODE で exit
 */
export function decideReloadAction(input: {
  baseline: string | null
  current: string | null
}): { action: "noop_unavailable" | "noop_unchanged" | "reload" } {
  if (input.baseline === null || input.current === null) return { action: "noop_unavailable" }
  if (input.baseline === input.current) return { action: "noop_unchanged" }
  return { action: "reload" }
}

export type SandboxReloadDeps = {
  /** TUI を終了させる関数。テストではモック差し替え用。 */
  exit?: (code: number) => never
  /** env の参照元。テストで上書きしやすいよう差し替え可。 */
  env?: NodeJS.ProcessEnv
  /** polling 間隔の上書き。テストで短縮するための注入口。 */
  pollIntervalMs?: number
}

const tui: TuiPlugin = async (api) => {
  await initSandboxReloadPlugin(api)
}

/**
 * plugin の本体。`tui` から呼ばれる。テストでは deps を注入して直接呼べる。
 *
 * supervisor から起動された TUI でなければ (= HASH_DIR_ENV が無い) 何も登録せず
 * 即 return する。これにより素の `opencode` 起動と完全互換になる。
 */
export async function initSandboxReloadPlugin(api: TuiPluginApi, deps: SandboxReloadDeps = {}): Promise<void> {
  const env = deps.env ?? process.env
  const exit = deps.exit ?? ((code: number) => process.exit(code))
  const hashDir = env[HASH_DIR_ENV]
  if (!hashDir) return

  const lastError = env[RELOAD_ERROR_ENV]
  if (lastError) {
    api.ui.toast({
      variant: "error",
      title: "サンドボックス設定の reload に失敗しました",
      message: lastError,
    })
  }

  const baselineHashFile = join(hashDir, BASELINE_HASH_FILENAME)
  const currentHashFile = join(hashDir, CURRENT_HASH_FILENAME)
  const reloadExitCode = resolveReloadExitCode(env)

  // current-hash の更新を 1 秒間隔で polling し、baseline と異なれば 1 度だけトーストを出す。
  // notifiedHash で去重して、同じ hash 値に対して再度 toast を出さない。
  // (fs.watch を使わない理由は HASH_POLL_INTERVAL_MS の JSDoc 参照。)
  let notifiedHash: string | null = null
  const checkOnce = () => {
    const baseline = readHashFile(baselineHashFile)
    const current = readHashFile(currentHashFile)
    if (!baseline || !current) return
    if (baseline === current) {
      // baseline に戻ったら去重も解除する。
      // 「A → B (toast) → A → B」のように同じ hash に戻った時に、二度目もちゃんと
      // toast が出るようにするため。
      notifiedHash = null
      return
    }
    if (notifiedHash === current) return
    notifiedHash = current
    api.ui.toast({
      variant: "info",
      title: "サンドボックス設定が変更されました",
      message: CHANGED_TOAST_MESSAGE,
      duration: 6000,
    })
  }
  const timer = setInterval(checkOnce, deps.pollIntervalMs ?? HASH_POLL_INTERVAL_MS)
  api.lifecycle.onDispose(() => clearInterval(timer))

  api.keymap.registerLayer({
    commands: [
      {
        name: "sandbox.reload",
        title: "Reload sandbox config",
        description: "sandbox.json を編集した後に実行すると、現在のセッションを保ったまま反映します",
        category: "System",
        slashName: "reload_sandbox",
        namespace: "palette",
        run() {
          const baseline = readHashFile(baselineHashFile)
          const current = readHashFile(currentHashFile)
          const decision = decideReloadAction({ baseline, current })

          if (decision.action === "noop_unavailable") {
            api.ui.toast({
              variant: "error",
              title: "/reload_sandbox",
              message:
                "サンドボックス設定の hash が読み込めません (supervisor との通信失敗)。" +
                "securecode を再起動してください。",
            })
            return
          }

          if (decision.action === "noop_unchanged") {
            // !!! reload を一切実行しない (process.exit を呼ばない)。
            // 子プロセスは生きたまま、ダイアログだけを重ねる = TUI ちらつき 0。
            api.ui.dialog.replace(() => (
              <api.ui.DialogAlert title="/reload_sandbox" message={SAME_HASH_DIALOG_MESSAGE} />
            ))
            return
          }

          // hash 差分あり → supervisor に reload を要求する exit。
          // supervisor が次の起動で --continue を付与してセッションを復元する。
          exit(reloadExitCode)
        },
      },
    ],
  })
}

const plugin: TuiPluginModule & { id: string } = {
  id: "sandbox-reload",
  tui,
}

export default plugin
