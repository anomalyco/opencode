// [fork-only] migrateLegacyWorkspace 测试
// [feat: imbot-workspace-rename] 2026-05-25
//
// 测试 plugin.ts 中导出的 migration helper。T1-T6 用 DI 友好 mock,T6 用真实 tmp fs。
// 测试用例对应 docs/features/imbot-workspace-rename/1-spec.md §测试用例。

import { describe, expect, mock, test } from "bun:test"
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { migrateLegacyWorkspace } from "../plugin"

function makeFakeFs(opts: {
  legacyExists: boolean
  newExists: boolean
  renameError?: Error
}) {
  const renameSyncMock = mock<(o: string, n: string) => void>(() => {
    if (opts.renameError) throw opts.renameError
  })
  return {
    existsSync: (p: string): boolean => {
      if (p.endsWith("feishu-workspace")) return opts.legacyExists
      if (p.endsWith("imbot-workspace")) return opts.newExists
      return false
    },
    renameSync: renameSyncMock,
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

describe("migrateLegacyWorkspace", () => {
  // T1
  test("T1: legacy 存在 + new 不存在 → migrated", () => {
    const fs = makeFakeFs({ legacyExists: true, newExists: false })
    const log = makeFakeLogger()
    const r = migrateLegacyWorkspace("/L/feishu-workspace", "/N/imbot-workspace", fs, log)
    expect(r).toBe("migrated")
    expect(fs.renameSync).toHaveBeenCalledTimes(1)
    expect(fs.renameSync).toHaveBeenCalledWith("/L/feishu-workspace", "/N/imbot-workspace")
    expect(log._info.join("\n")).toContain("migrated legacy workspace")
  })

  // T2
  test("T2: legacy 不存在 + new 存在 → noop-already-new", () => {
    const fs = makeFakeFs({ legacyExists: false, newExists: true })
    const log = makeFakeLogger()
    const r = migrateLegacyWorkspace("/L/feishu-workspace", "/N/imbot-workspace", fs, log)
    expect(r).toBe("noop-already-new")
    expect(fs.renameSync).toHaveBeenCalledTimes(0)
  })

  // T3
  test("T3: 两者都不存在(初次安装)→ noop-no-legacy", () => {
    const fs = makeFakeFs({ legacyExists: false, newExists: false })
    const log = makeFakeLogger()
    const r = migrateLegacyWorkspace("/L/feishu-workspace", "/N/imbot-workspace", fs, log)
    expect(r).toBe("noop-no-legacy")
    expect(fs.renameSync).toHaveBeenCalledTimes(0)
  })

  // T4
  test("T4: 两者都存在 → skipped-both-exist + warn", () => {
    const fs = makeFakeFs({ legacyExists: true, newExists: true })
    const log = makeFakeLogger()
    const r = migrateLegacyWorkspace("/L/feishu-workspace", "/N/imbot-workspace", fs, log)
    expect(r).toBe("skipped-both-exist")
    expect(fs.renameSync).toHaveBeenCalledTimes(0)
    expect(log._warn.join("\n")).toContain("both")
  })

  // T5
  test("T5: rename 抛 EACCES → failed + warn + 不崩", () => {
    const fs = makeFakeFs({
      legacyExists: true,
      newExists: false,
      renameError: new Error("EACCES: permission denied"),
    })
    const log = makeFakeLogger()
    let r: ReturnType<typeof migrateLegacyWorkspace> | undefined
    expect(() => {
      r = migrateLegacyWorkspace("/L/feishu-workspace", "/N/imbot-workspace", fs, log)
    }).not.toThrow()
    expect(r).toBe("failed")
    expect(log._warn.join("\n")).toContain("failed to migrate")
    expect(log._warn.join("\n")).toContain("EACCES")
  })

  // T6 — real fs tmp dir,验证 mv 后子内容跟着走
  test("T6: 真实 fs mv,legacy 子目录 + 文件全部跟着到 new 路径", () => {
    const tmp = mkdtempSync(join(tmpdir(), "migrate-ws-test-"))
    const legacy = join(tmp, "feishu-workspace")
    const newP = join(tmp, "imbot-workspace")
    mkdirSync(join(legacy, ".opencode", "agent"), { recursive: true })
    writeFileSync(join(legacy, ".opencode", "agent", "imbot.md"), "test content", "utf-8")
    writeFileSync(join(legacy, "test.png"), "fake png", "utf-8")

    const log = makeFakeLogger()
    const r = migrateLegacyWorkspace(legacy, newP, { existsSync, renameSync }, log)
    expect(r).toBe("migrated")
    expect(existsSync(legacy)).toBe(false)
    expect(existsSync(newP)).toBe(true)
    expect(readFileSync(join(newP, ".opencode", "agent", "imbot.md"), "utf-8")).toBe("test content")
    expect(readFileSync(join(newP, "test.png"), "utf-8")).toBe("fake png")
    expect(log._info.join("\n")).toContain("migrated legacy workspace")

    rmSync(tmp, { recursive: true, force: true })
  })
})
