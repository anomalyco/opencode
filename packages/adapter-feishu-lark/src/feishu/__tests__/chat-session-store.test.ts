// [fork-only] ChatSessionStore 单测
// [feat: feishu-bridge] 2026-05-09

import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs"
import { tmpdir, platform } from "node:os"
import { join } from "node:path"
import { ChatSessionStore } from "../chat-session-store"

let tmpDir: string

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "chat-session-store-test-"))
})

afterEach(() => {
  if (existsSync(tmpDir)) {
    rmSync(tmpDir, { recursive: true, force: true })
  }
})

function p(): string {
  return join(tmpDir, "chat-sessions.json")
}

// ============================================================
// load / 默认空 / fallback
// ============================================================

describe("loadFromDisk", () => {
  test("文件不存在 → 空 store", () => {
    const s = new ChatSessionStore(p())
    expect(s.get("acc1", "chat1")).toBeUndefined()
  })

  test("文件存在 + 合法 → 解析", () => {
    const initial = new ChatSessionStore(p())
    initial.set("acc1", "chat-a", "ses_xxx")
    // 新实例 reload
    const next = new ChatSessionStore(p())
    expect(next.get("acc1", "chat-a")).toBe("ses_xxx")
  })

  test("文件 corrupt JSON → fallback 空", () => {
    require("node:fs").writeFileSync(p(), "not-json", "utf-8")
    const s = new ChatSessionStore(p())
    expect(s.get("acc1", "chat1")).toBeUndefined()
  })
})

// ============================================================
// set / get / delete
// ============================================================

describe("set + get", () => {
  test("set 后 get 返刚 set 的值", () => {
    const s = new ChatSessionStore(p())
    s.set("acc1", "chat-A", "ses_111")
    expect(s.get("acc1", "chat-A")).toBe("ses_111")
  })

  test("不同 account / chat 互不干扰", () => {
    const s = new ChatSessionStore(p())
    s.set("acc1", "chat-A", "ses_a")
    s.set("acc1", "chat-B", "ses_b")
    s.set("acc2", "chat-A", "ses_c")
    expect(s.get("acc1", "chat-A")).toBe("ses_a")
    expect(s.get("acc1", "chat-B")).toBe("ses_b")
    expect(s.get("acc2", "chat-A")).toBe("ses_c")
    expect(s.get("acc1", "chat-X")).toBeUndefined()
    expect(s.get("acc999", "chat-A")).toBeUndefined()
  })

  test("set 同 chatId 会覆盖", () => {
    const s = new ChatSessionStore(p())
    s.set("acc1", "chat-A", "ses_old")
    s.set("acc1", "chat-A", "ses_new")
    expect(s.get("acc1", "chat-A")).toBe("ses_new")
  })

  test("set 后立即落盘(magic 字段 version: 1)", () => {
    const s = new ChatSessionStore(p())
    s.set("acc1", "chat-A", "ses_xxx")
    expect(existsSync(p())).toBe(true)
    const json = JSON.parse(readFileSync(p(), "utf-8"))
    expect(json.version).toBe(1)
    expect(json.sessions.acc1["chat-A"]).toBe("ses_xxx")
  })

  test("POSIX:文件权限 0600", () => {
    if (platform() === "win32") return
    const s = new ChatSessionStore(p())
    s.set("acc1", "chat-A", "ses_xxx")
    const stat = statSync(p())
    expect(stat.mode & 0o777).toBe(0o600)
  })
})

// ============================================================
// delete
// ============================================================

describe("delete", () => {
  test("删单 chatId,其它不动", () => {
    const s = new ChatSessionStore(p())
    s.set("acc1", "chat-A", "ses_a")
    s.set("acc1", "chat-B", "ses_b")
    s.delete("acc1", "chat-A")
    expect(s.get("acc1", "chat-A")).toBeUndefined()
    expect(s.get("acc1", "chat-B")).toBe("ses_b")
  })

  test("删最后一个 chatId 后 account 自动清", () => {
    const s = new ChatSessionStore(p())
    s.set("acc1", "chat-A", "ses_a")
    s.delete("acc1", "chat-A")
    expect(s.listChats("acc1")).toEqual([])
    // 落盘验证 account map 已清
    const json = JSON.parse(readFileSync(p(), "utf-8"))
    expect(json.sessions.acc1).toBeUndefined()
  })

  test("删不存在的 chatId 不抛", () => {
    const s = new ChatSessionStore(p())
    expect(() => s.delete("acc1", "missing")).not.toThrow()
  })
})

// ============================================================
// deleteAccount
// ============================================================

describe("deleteAccount", () => {
  test("删 account 所有 chatId", () => {
    const s = new ChatSessionStore(p())
    s.set("acc1", "chat-A", "ses_a")
    s.set("acc1", "chat-B", "ses_b")
    s.set("acc2", "chat-X", "ses_x")
    s.deleteAccount("acc1")
    expect(s.listChats("acc1")).toEqual([])
    expect(s.get("acc2", "chat-X")).toBe("ses_x")
  })

  test("删不存在 account 不抛", () => {
    const s = new ChatSessionStore(p())
    expect(() => s.deleteAccount("never")).not.toThrow()
  })
})

// ============================================================
// listChats
// ============================================================

describe("listChats", () => {
  test("空 → 空数组", () => {
    const s = new ChatSessionStore(p())
    expect(s.listChats("acc1")).toEqual([])
  })

  test("3 个 chat 全列出", () => {
    const s = new ChatSessionStore(p())
    s.set("acc1", "a", "ses_a")
    s.set("acc1", "b", "ses_b")
    s.set("acc1", "c", "ses_c")
    expect(s.listChats("acc1").sort()).toEqual(["a", "b", "c"])
  })
})

// ============================================================
// 综合:plugin 重启场景
// ============================================================

describe("plugin 重启场景", () => {
  test("plugin1 写 → plugin2 读 → 复用 session", () => {
    const plugin1 = new ChatSessionStore(p())
    plugin1.set("cli_a", "oc_chat_xxx", "ses_first")

    // 模拟 plugin 重启:新 store 实例从同 path
    const plugin2 = new ChatSessionStore(p())
    expect(plugin2.get("cli_a", "oc_chat_xxx")).toBe("ses_first")

    // 第二个 chat 来,plugin2 写入
    plugin2.set("cli_a", "oc_chat_yyy", "ses_second")

    // plugin3 读取,两个都见
    const plugin3 = new ChatSessionStore(p())
    expect(plugin3.get("cli_a", "oc_chat_xxx")).toBe("ses_first")
    expect(plugin3.get("cli_a", "oc_chat_yyy")).toBe("ses_second")
  })
})
