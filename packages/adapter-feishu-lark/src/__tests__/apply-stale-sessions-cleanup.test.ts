// [fork-only] applyStaleSessionsCleanup 单测
// [feat: imbot-workspace-rename-followup] 2026-05-25
//
// 测试 plugin.ts 中导出的 cleanup helper。T1-T5 用 DI mock,T6 用真实 tmp fs。
// 测试用例对应 docs/features/imbot-workspace-rename-followup/1-spec.md §测试用例。

import { describe, expect, mock, test } from "bun:test"
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  unlinkSync as realUnlinkSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { applyStaleSessionsCleanup } from "../plugin"

function makeFakeFs(opts: {
  markerExists: boolean
  storeExists: boolean
  unlinkError?: Error
  writeFileError?: Error
}) {
  const unlinkSyncMock = mock<(p: string) => void>(() => {
    if (opts.unlinkError) throw opts.unlinkError
  })
  const writeFileSyncMock = mock<(p: string, d: string) => void>(() => {
    if (opts.writeFileError) throw opts.writeFileError
  })
  return {
    existsSync: (p: string): boolean => {
      if (p.endsWith("cleanup-applied")) return opts.markerExists
      if (p.endsWith("chat-sessions.json")) return opts.storeExists
      return false
    },
    unlinkSync: unlinkSyncMock,
    writeFileSync: writeFileSyncMock,
  }
}

function makeFakeLogger() {
  const info: string[] = []
  const warn: string[] = []
  return {
    info: (m: string) => info.push(m),
    warn: (m: string) => warn.push(m),
    _info: info,
    _warn: warn,
  }
}

describe("applyStaleSessionsCleanup", () => {
  test("T1: marker 已存在 → noop-already-applied", () => {
    const fs = makeFakeFs({ markerExists: true, storeExists: true })
    const log = makeFakeLogger()
    const r = applyStaleSessionsCleanup(
      "/M/.imbot-workspace-rename-cleanup-applied",
      "/S/feishu-chat-sessions.json",
      fs,
      log,
    )
    expect(r).toBe("noop-already-applied")
    expect(fs.unlinkSync).toHaveBeenCalledTimes(0)
    expect(fs.writeFileSync).toHaveBeenCalledTimes(0)
  })

  test("T2: marker 不存在 + chatStore 不存在 → noop-no-sessions + 写 marker", () => {
    const fs = makeFakeFs({ markerExists: false, storeExists: false })
    const log = makeFakeLogger()
    const r = applyStaleSessionsCleanup(
      "/M/.imbot-workspace-rename-cleanup-applied",
      "/S/feishu-chat-sessions.json",
      fs,
      log,
    )
    expect(r).toBe("noop-no-sessions")
    expect(fs.unlinkSync).toHaveBeenCalledTimes(0)
    expect(fs.writeFileSync).toHaveBeenCalledTimes(1)
  })

  test("T3: marker 不存在 + chatStore 存在 → applied + 清 + 写 marker", () => {
    const fs = makeFakeFs({ markerExists: false, storeExists: true })
    const log = makeFakeLogger()
    const r = applyStaleSessionsCleanup(
      "/M/.imbot-workspace-rename-cleanup-applied",
      "/S/feishu-chat-sessions.json",
      fs,
      log,
    )
    expect(r).toBe("applied")
    expect(fs.unlinkSync).toHaveBeenCalledTimes(1)
    expect(fs.unlinkSync).toHaveBeenCalledWith("/S/feishu-chat-sessions.json")
    expect(fs.writeFileSync).toHaveBeenCalledTimes(1)
    expect(log._info.join("\n")).toContain("cleared stale chat sessions")
  })

  test("T4: unlink chatStore 抛 EACCES → failed + warn + 不写 marker", () => {
    const fs = makeFakeFs({
      markerExists: false,
      storeExists: true,
      unlinkError: new Error("EACCES: permission denied"),
    })
    const log = makeFakeLogger()
    let r: ReturnType<typeof applyStaleSessionsCleanup> | undefined
    expect(() => {
      r = applyStaleSessionsCleanup(
        "/M/.imbot-workspace-rename-cleanup-applied",
        "/S/feishu-chat-sessions.json",
        fs,
        log,
      )
    }).not.toThrow()
    expect(r).toBe("failed")
    expect(fs.writeFileSync).toHaveBeenCalledTimes(0)
    expect(log._warn.join("\n")).toContain("EACCES")
    expect(log._warn.join("\n")).toContain("failed to clear stale chat sessions")
  })

  test("T5: chatStore 不存在 + 写 marker 抛 ENOSPC → failed + warn", () => {
    const fs = makeFakeFs({
      markerExists: false,
      storeExists: false,
      writeFileError: new Error("ENOSPC: no space left on device"),
    })
    const log = makeFakeLogger()
    let r: ReturnType<typeof applyStaleSessionsCleanup> | undefined
    expect(() => {
      r = applyStaleSessionsCleanup(
        "/M/.imbot-workspace-rename-cleanup-applied",
        "/S/feishu-chat-sessions.json",
        fs,
        log,
      )
    }).not.toThrow()
    expect(r).toBe("failed")
    expect(log._warn.join("\n")).toContain("ENOSPC")
    expect(log._warn.join("\n")).toContain("failed to write cleanup marker")
  })

  test("T6: 真实 fs:chatStore 存在 → applied,文件被删 + marker 创建含 valid JSON", () => {
    const tmp = mkdtempSync(join(tmpdir(), "cleanup-test-"))
    const marker = join(tmp, ".imbot-workspace-rename-cleanup-applied")
    const store = join(tmp, "feishu-chat-sessions.json")
    writeFileSync(
      store,
      JSON.stringify({ version: 1, sessions: { acc1: { chat1: "ses_old" } } }),
      "utf-8",
    )

    const log = makeFakeLogger()
    const r = applyStaleSessionsCleanup(
      marker,
      store,
      { existsSync, unlinkSync: realUnlinkSync, writeFileSync },
      log,
    )
    expect(r).toBe("applied")
    expect(existsSync(store)).toBe(false)
    expect(existsSync(marker)).toBe(true)
    const markerContent = JSON.parse(readFileSync(marker, "utf-8"))
    expect(markerContent.feat).toBe("imbot-workspace-rename")
    expect(typeof markerContent.appliedAt).toBe("string")
    expect(log._info.join("\n")).toContain("cleared stale chat sessions")

    rmSync(tmp, { recursive: true, force: true })
  })
})
