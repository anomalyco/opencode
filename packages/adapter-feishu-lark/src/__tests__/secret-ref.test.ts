// [fork-only] SecretRef 单测 — 三档(plaintext / env / file)读写 + schema 校验 + 边界
// [feat: feishu-bridge] 2026-05-08
//
// R5 Logic 清单覆盖率 ≥ 80% 目标

import { describe, expect, test, beforeEach, afterEach } from "bun:test"
import { existsSync, mkdtempSync, rmSync, statSync } from "node:fs"
import { tmpdir, platform } from "node:os"
import { join } from "node:path"
import {
  writeSecret,
  readSecret,
  deleteSecret,
  defaultMode,
  defaultFilePath,
  SecretRefSchema,
  type SecretRef,
} from "../core/secret-ref"

// ============================================================
// 临时目录:每个测试隔离
// ============================================================

let tmpDir: string

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "secret-ref-test-"))
})

afterEach(() => {
  if (existsSync(tmpDir)) {
    rmSync(tmpDir, { recursive: true, force: true })
  }
})

// ============================================================
// schema
// ============================================================

describe("SecretRefSchema", () => {
  test("plaintext 解析", () => {
    const r = SecretRefSchema.parse({ type: "plaintext", value: "abc123" })
    expect(r).toEqual({ type: "plaintext", value: "abc123" })
  })

  test("env 解析", () => {
    const r = SecretRefSchema.parse({ type: "env", name: "MY_SECRET" })
    expect(r).toEqual({ type: "env", name: "MY_SECRET" })
  })

  test("file 解析", () => {
    const r = SecretRefSchema.parse({ type: "file", path: "/tmp/x.key" })
    expect(r).toEqual({ type: "file", path: "/tmp/x.key" })
  })

  test("非法 type 拒绝", () => {
    expect(() => SecretRefSchema.parse({ type: "keychain", value: "x" })).toThrow()
  })

  test("env 模式 name 不可空", () => {
    expect(() => SecretRefSchema.parse({ type: "env", name: "" })).toThrow()
  })

  test("file 模式 path 不可空", () => {
    expect(() => SecretRefSchema.parse({ type: "file", path: "" })).toThrow()
  })

  test("plaintext 模式 value 缺失", () => {
    expect(() => SecretRefSchema.parse({ type: "plaintext" })).toThrow()
  })
})

// ============================================================
// 平台默认
// ============================================================

describe("defaultMode", () => {
  test("当前平台返一个合法模式", () => {
    const m = defaultMode()
    expect(["plaintext", "file"]).toContain(m)
  })

  test("跟当前平台对齐", () => {
    const m = defaultMode()
    if (platform() === "win32") {
      expect(m).toBe("plaintext")
    } else {
      expect(m).toBe("file")
    }
  })
})

describe("defaultFilePath", () => {
  test("含 ~/.opencode/feishu-secrets/", () => {
    const p = defaultFilePath("appid_123")
    expect(p).toContain(".opencode/feishu-secrets")
    expect(p).toEndWith("appid_123.key")
  })

  test("path traversal 防护:特殊字符替换 _", () => {
    const p = defaultFilePath("../etc/passwd")
    expect(p).not.toContain("..")
    expect(p).toEndWith("__etc_passwd.key")
  })

  test("空 id fallback default", () => {
    const p = defaultFilePath("")
    expect(p).toEndWith(".key")
  })
})

// ============================================================
// plaintext 读写
// ============================================================

describe("plaintext 模式", () => {
  test("write + read roundtrip", () => {
    const ref = writeSecret("my-secret-value", { mode: "plaintext" })
    expect(ref).toEqual({ type: "plaintext", value: "my-secret-value" })
    expect(readSecret(ref)).toBe("my-secret-value")
  })

  test("空字符串 OK", () => {
    const ref = writeSecret("", { mode: "plaintext" })
    expect(readSecret(ref)).toBe("")
  })

  test("含特殊字符 / 中文 / 换行", () => {
    const secret = "line1\nline2\t特殊字符 \"quote\" 'single'"
    const ref = writeSecret(secret, { mode: "plaintext" })
    expect(readSecret(ref)).toBe(secret)
  })
})

// ============================================================
// env 模式
// ============================================================

describe("env 模式", () => {
  test("write 返 ref(不实际设 env)", () => {
    const ref = writeSecret("ignored", { mode: "env", envName: "TEST_SECRET" })
    expect(ref).toEqual({ type: "env", name: "TEST_SECRET" })
  })

  test("read 从 process.env 取", () => {
    process.env.TEST_FEISHU_SECRET = "from-env"
    try {
      const ref: SecretRef = { type: "env", name: "TEST_FEISHU_SECRET" }
      expect(readSecret(ref)).toBe("from-env")
    } finally {
      delete process.env.TEST_FEISHU_SECRET
    }
  })

  test("env var 未设 → throw", () => {
    const ref: SecretRef = { type: "env", name: "DEFINITELY_NOT_SET_VAR_XYZ" }
    expect(() => readSecret(ref)).toThrow(/env var .* not set/)
  })

  test("write 缺 envName → throw", () => {
    expect(() => writeSecret("x", { mode: "env" })).toThrow(/envName/)
  })
})

// ============================================================
// file 模式
// ============================================================

describe("file 模式", () => {
  test("write 创建文件 + read 读出", () => {
    const path = join(tmpDir, "test.key")
    const ref = writeSecret("file-content-123", { mode: "file", filePath: path })
    expect(ref).toEqual({ type: "file", path })
    expect(existsSync(path)).toBe(true)
    expect(readSecret(ref)).toBe("file-content-123")
  })

  test("POSIX:文件权限 0600", () => {
    if (platform() === "win32") {
      // Windows chmod 是 no-op,跳
      return
    }
    const path = join(tmpDir, "perm.key")
    writeSecret("x", { mode: "file", filePath: path })
    const stat = statSync(path)
    // mode 后 9 位是 rwx;0600 = owner rw + 0 group + 0 other
    const perm = stat.mode & 0o777
    expect(perm).toBe(0o600)
  })

  test("read 不存在文件 → throw", () => {
    const ref: SecretRef = { type: "file", path: join(tmpDir, "missing.key") }
    expect(() => readSecret(ref)).toThrow(/secret file not found/)
  })

  test("write 自动建中间目录", () => {
    const deepPath = join(tmpDir, "deep", "nested", "dir", "secret.key")
    writeSecret("y", { mode: "file", filePath: deepPath })
    expect(existsSync(deepPath)).toBe(true)
  })

  test("不带 filePath 时用 default + id", () => {
    const ref = writeSecret("z", { mode: "file", id: "test_appid" })
    expect(ref.type).toBe("file")
    if (ref.type === "file") {
      expect(ref.path).toContain("test_appid.key")
      // 测完 cleanup(default path 写到 home)
      try {
        deleteSecret(ref)
      } catch {
        // ignore
      }
    }
  })

  test("read trim 末尾换行", () => {
    const path = join(tmpDir, "trailing.key")
    // 模拟 user 用编辑器存 secret 自动加换行
    require("node:fs").writeFileSync(path, "secret\n", "utf-8")
    const ref: SecretRef = { type: "file", path }
    expect(readSecret(ref)).toBe("secret")
  })
})

// ============================================================
// deleteSecret
// ============================================================

describe("deleteSecret", () => {
  test("file 模式:文件被删", () => {
    const path = join(tmpDir, "to-delete.key")
    const ref = writeSecret("x", { mode: "file", filePath: path })
    expect(existsSync(path)).toBe(true)
    deleteSecret(ref)
    expect(existsSync(path)).toBe(false)
  })

  test("file 模式:已不存在不 throw(idempotent)", () => {
    const ref: SecretRef = { type: "file", path: join(tmpDir, "nonexistent.key") }
    expect(() => deleteSecret(ref)).not.toThrow()
  })

  test("plaintext / env 模式:no-op", () => {
    expect(() => deleteSecret({ type: "plaintext", value: "x" })).not.toThrow()
    expect(() => deleteSecret({ type: "env", name: "X" })).not.toThrow()
  })
})

// ============================================================
// 综合:默认模式 roundtrip
// ============================================================

describe("默认模式 roundtrip", () => {
  test("不指定 mode 用 platform 默认", () => {
    const id = "default-test-id"
    const ref = writeSecret("default-value", { id })
    expect(ref.type).toBe(defaultMode())
    expect(readSecret(ref)).toBe("default-value")
    // cleanup
    try {
      deleteSecret(ref)
    } catch {
      // ignore
    }
  })
})
