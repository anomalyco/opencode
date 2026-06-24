import { describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  decideReloadAction,
  initSandboxReloadPlugin,
  readHashFile,
  resolveReloadExitCode,
  BASELINE_HASH_FILENAME,
  CURRENT_HASH_FILENAME,
  DEFAULT_RELOAD_EXIT_CODE,
  HASH_DIR_ENV,
  RELOAD_ERROR_ENV,
  RELOAD_EXIT_CODE_ENV,
} from "../../src/securecode/tui-plugins/sandbox-reload"
import {
  BASELINE_HASH_FILENAME as SUPERVISOR_BASELINE_HASH_FILENAME,
  CURRENT_HASH_FILENAME as SUPERVISOR_CURRENT_HASH_FILENAME,
  RELOAD_ERROR_ENV as SUPERVISOR_RELOAD_ERROR_ENV,
  RELOAD_EXIT_CODE as SUPERVISOR_RELOAD_EXIT_CODE,
  RELOAD_EXIT_CODE_ENV as SUPERVISOR_RELOAD_EXIT_CODE_ENV,
  SANDBOX_HASH_DIR_ENV,
} from "../../../../script/securecode-supervisor"

describe("decideReloadAction", () => {
  test("baseline が null なら noop_unavailable", () => {
    expect(decideReloadAction({ baseline: null, current: "x" })).toEqual({ action: "noop_unavailable" })
  })

  test("current が null なら noop_unavailable", () => {
    expect(decideReloadAction({ baseline: "x", current: null })).toEqual({ action: "noop_unavailable" })
  })

  test("hash が同一なら noop_unchanged (reload しない)", () => {
    expect(decideReloadAction({ baseline: "abc", current: "abc" })).toEqual({ action: "noop_unchanged" })
  })

  test("hash が違えば reload", () => {
    expect(decideReloadAction({ baseline: "abc", current: "def" })).toEqual({ action: "reload" })
  })
})

describe("resolveReloadExitCode", () => {
  test("env 未指定なら default を返す", () => {
    expect(resolveReloadExitCode({})).toBe(DEFAULT_RELOAD_EXIT_CODE)
  })

  test("env が数値文字列ならそれを int として返す", () => {
    expect(resolveReloadExitCode({ [RELOAD_EXIT_CODE_ENV]: "200" })).toBe(200)
  })

  test("env が不正なら default を返す", () => {
    expect(resolveReloadExitCode({ [RELOAD_EXIT_CODE_ENV]: "not-a-number" })).toBe(DEFAULT_RELOAD_EXIT_CODE)
  })

  test("空文字も default にフォールバック", () => {
    expect(resolveReloadExitCode({ [RELOAD_EXIT_CODE_ENV]: "" })).toBe(DEFAULT_RELOAD_EXIT_CODE)
  })
})

describe("readHashFile", () => {
  test("存在しないパスは null", () => {
    expect(readHashFile("/nonexistent/securecode-test/baseline-hash")).toBeNull()
  })

  test("ファイルから trim 済み文字列を返す", () => {
    const dir = mkdtempSync(join(tmpdir(), "securecode-readhash-"))
    const p = join(dir, "h")
    writeFileSync(p, "abc123\n")
    try {
      expect(readHashFile(p)).toBe("abc123")
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe("decideReloadAction (シナリオ統合)", () => {
  test("ユーザが /reload_sandbox を試し打ちした場合: hash 変更なし → reload は走らない", () => {
    // 「気軽に試し打ちしても何も壊れない」設計上の約束を、純関数レベルで凍結する。
    const decision = decideReloadAction({ baseline: "same-hash", current: "same-hash" })
    expect(decision.action).not.toBe("reload")
    expect(decision.action).toBe("noop_unchanged")
  })

  test("ユーザが sandbox.json を編集後に /reload_sandbox を叩いた場合: reload する", () => {
    const decision = decideReloadAction({ baseline: "old-hash", current: "new-hash" })
    expect(decision.action).toBe("reload")
  })
})

describe("supervisor との契約 (定数の一致)", () => {
  test("env 名 / exit code / hash ファイル名が supervisor 側の定義と一致する", () => {
    // plugin (packages/opencode) と supervisor (script/) は依存方向の都合で
    // 定数を import し合えない。文字列の二重定義になっているため、片方だけ
    // rename される事故をこのテストで凍結する。
    expect(HASH_DIR_ENV).toBe(SANDBOX_HASH_DIR_ENV)
    expect(RELOAD_EXIT_CODE_ENV).toBe(SUPERVISOR_RELOAD_EXIT_CODE_ENV)
    expect(RELOAD_ERROR_ENV).toBe(SUPERVISOR_RELOAD_ERROR_ENV)
    expect(DEFAULT_RELOAD_EXIT_CODE).toBe(SUPERVISOR_RELOAD_EXIT_CODE)
    expect(BASELINE_HASH_FILENAME).toBe(SUPERVISOR_BASELINE_HASH_FILENAME)
    expect(CURRENT_HASH_FILENAME).toBe(SUPERVISOR_CURRENT_HASH_FILENAME)
  })
})

/**
 * initSandboxReloadPlugin が触る api 表面 (ui.toast / ui.dialog.replace /
 * keymap.registerLayer / lifecycle.onDispose) だけを記録するモック。
 */
function makeApiMock() {
  const toasts: { variant?: string; title?: string; message: string }[] = []
  const dialogs: unknown[] = []
  const layers: { commands: { slashName?: string; run: () => void }[] }[] = []
  const disposers: (() => unknown)[] = []
  const api = {
    ui: {
      toast: (t: { variant?: string; title?: string; message: string }) => {
        toasts.push(t)
      },
      dialog: {
        replace: (render: unknown) => {
          dialogs.push(render)
        },
      },
      DialogAlert: () => null,
    },
    keymap: {
      registerLayer: (layer: { commands: { slashName?: string; run: () => void }[] }) => {
        layers.push(layer)
        return () => {}
      },
    },
    lifecycle: {
      onDispose: (fn: () => unknown) => {
        disposers.push(fn)
        return () => {}
      },
    },
  } as unknown as Parameters<typeof initSandboxReloadPlugin>[0]
  const dispose = () => {
    for (const fn of disposers) void fn()
  }
  return { api, toasts, dialogs, layers, dispose }
}

describe("initSandboxReloadPlugin (配線)", () => {
  test("HASH_DIR_ENV が無ければ何も登録しない (素の opencode 互換)", async () => {
    const m = makeApiMock()
    await initSandboxReloadPlugin(m.api, { env: {} })
    expect(m.layers.length).toBe(0)
    expect(m.toasts.length).toBe(0)
  })

  test("hash 同一で /reload_sandbox: ダイアログだけ出して exit を呼ばない", async () => {
    const dir = mkdtempSync(join(tmpdir(), "securecode-plugwire-"))
    writeFileSync(join(dir, BASELINE_HASH_FILENAME), "abc")
    writeFileSync(join(dir, CURRENT_HASH_FILENAME), "abc")
    const m = makeApiMock()
    const exits: number[] = []
    try {
      await initSandboxReloadPlugin(m.api, {
        env: { [HASH_DIR_ENV]: dir },
        exit: ((code: number) => {
          exits.push(code)
        }) as unknown as (code: number) => never,
      })
      const cmd = m.layers[0]!.commands[0]!
      expect(cmd.slashName).toBe("reload_sandbox")
      cmd.run()
      expect(exits).toEqual([])
      expect(m.dialogs.length).toBe(1)
    } finally {
      m.dispose()
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("hash 差分ありで /reload_sandbox: RELOAD_EXIT_CODE で exit する", async () => {
    const dir = mkdtempSync(join(tmpdir(), "securecode-plugwire-"))
    writeFileSync(join(dir, BASELINE_HASH_FILENAME), "abc")
    writeFileSync(join(dir, CURRENT_HASH_FILENAME), "def")
    const m = makeApiMock()
    const exits: number[] = []
    try {
      await initSandboxReloadPlugin(m.api, {
        env: { [HASH_DIR_ENV]: dir, [RELOAD_EXIT_CODE_ENV]: "75" },
        exit: ((code: number) => {
          exits.push(code)
        }) as unknown as (code: number) => never,
      })
      m.layers[0]!.commands[0]!.run()
      expect(exits).toEqual([75])
      expect(m.dialogs.length).toBe(0)
    } finally {
      m.dispose()
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("hash ファイル不在で /reload_sandbox: error toast を出して exit しない", async () => {
    const dir = mkdtempSync(join(tmpdir(), "securecode-plugwire-"))
    const m = makeApiMock()
    const exits: number[] = []
    try {
      await initSandboxReloadPlugin(m.api, {
        env: { [HASH_DIR_ENV]: dir },
        exit: ((code: number) => {
          exits.push(code)
        }) as unknown as (code: number) => never,
      })
      m.layers[0]!.commands[0]!.run()
      expect(exits).toEqual([])
      expect(m.toasts.some((t) => t.variant === "error")).toBe(true)
    } finally {
      m.dispose()
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("RELOAD_ERROR_ENV があれば起動時に error toast を 1 回出す", async () => {
    const dir = mkdtempSync(join(tmpdir(), "securecode-plugwire-"))
    writeFileSync(join(dir, BASELINE_HASH_FILENAME), "abc")
    writeFileSync(join(dir, CURRENT_HASH_FILENAME), "abc")
    const m = makeApiMock()
    try {
      await initSandboxReloadPlugin(m.api, {
        env: { [HASH_DIR_ENV]: dir, [RELOAD_ERROR_ENV]: "sandbox.json の parse に失敗しました" },
      })
      const errorToasts = m.toasts.filter((t) => t.variant === "error")
      expect(errorToasts.length).toBe(1)
      expect(errorToasts[0]!.message).toContain("parse に失敗")
    } finally {
      m.dispose()
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe("initSandboxReloadPlugin (polling)", () => {
  test("polling: 後から current-hash が baseline と乖離したら 1 度だけ info toast を出す", async () => {
    // sandbox 内では fs.watch がイベントを取りこぼすため (macOS Seatbelt の FSEvents
    // 制約)、plugin は polling 方式で hash の乖離を検知する。
    const dir = mkdtempSync(join(tmpdir(), "securecode-poll-"))
    writeFileSync(join(dir, BASELINE_HASH_FILENAME), "abc")
    writeFileSync(join(dir, CURRENT_HASH_FILENAME), "abc")
    const m = makeApiMock()
    try {
      await initSandboxReloadPlugin(m.api, {
        env: { [HASH_DIR_ENV]: dir },
        pollIntervalMs: 20,
      })
      // 起動直後は baseline == current なので toast は出ない
      await new Promise((r) => setTimeout(r, 60))
      expect(m.toasts.filter((t) => t.variant === "info").length).toBe(0)

      // sandbox.json が編集されて supervisor 側 watcher が current-hash を上書きした想定
      writeFileSync(join(dir, CURRENT_HASH_FILENAME), "def")
      // polling tick 1 つ以上待つ
      const deadline = Date.now() + 1000
      while (Date.now() < deadline && m.toasts.filter((t) => t.variant === "info").length === 0) {
        await new Promise((r) => setTimeout(r, 30))
      }
      expect(m.toasts.filter((t) => t.variant === "info").length).toBe(1)

      // 同じ hash が続く間は再 toast しない (= 多重通知防止)
      await new Promise((r) => setTimeout(r, 80))
      expect(m.toasts.filter((t) => t.variant === "info").length).toBe(1)
    } finally {
      m.dispose()
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("polling: baseline に戻ったあと別の編集が来たら、再度 toast を出す", async () => {
    // notifiedHash dedupe で握り潰されないリグレッション防止。
    // 編集 → toast → 取り消し (baseline 戻り) → 再編集 → toast、の流れ。
    const dir = mkdtempSync(join(tmpdir(), "securecode-poll-redo-"))
    writeFileSync(join(dir, BASELINE_HASH_FILENAME), "abc")
    writeFileSync(join(dir, CURRENT_HASH_FILENAME), "abc")
    const m = makeApiMock()
    const infoToastCount = () => m.toasts.filter((t) => t.variant === "info").length
    const waitFor = async (target: number) => {
      const deadline = Date.now() + 1000
      while (Date.now() < deadline && infoToastCount() < target) {
        await new Promise((r) => setTimeout(r, 30))
      }
    }
    try {
      await initSandboxReloadPlugin(m.api, {
        env: { [HASH_DIR_ENV]: dir },
        pollIntervalMs: 20,
      })

      // 1 回目の編集 → toast
      writeFileSync(join(dir, CURRENT_HASH_FILENAME), "def")
      await waitFor(1)
      expect(infoToastCount()).toBe(1)

      // baseline と同じ値に戻す (notifiedHash を null にリセットする副作用がある)
      writeFileSync(join(dir, CURRENT_HASH_FILENAME), "abc")
      await new Promise((r) => setTimeout(r, 80))
      expect(infoToastCount()).toBe(1)

      // 2 回目の編集 — 同じ "def" でも別の編集サイクルとして再 toast されるべき
      writeFileSync(join(dir, CURRENT_HASH_FILENAME), "def")
      await waitFor(2)
      expect(infoToastCount()).toBe(2)
    } finally {
      m.dispose()
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("polling: dispose で interval が停止する (リーク防止)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "securecode-poll-dispose-"))
    writeFileSync(join(dir, BASELINE_HASH_FILENAME), "abc")
    writeFileSync(join(dir, CURRENT_HASH_FILENAME), "abc")
    const m = makeApiMock()
    try {
      await initSandboxReloadPlugin(m.api, {
        env: { [HASH_DIR_ENV]: dir },
        pollIntervalMs: 20,
      })
      m.dispose() // ← onDispose で clearInterval される
      writeFileSync(join(dir, CURRENT_HASH_FILENAME), "def")
      await new Promise((r) => setTimeout(r, 80))
      // dispose 済みなので toast は増えない
      expect(m.toasts.filter((t) => t.variant === "info").length).toBe(0)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
