// [fork-only] SecretRef 三档凭证存储 — plaintext / env / file
// [feat: feishu-bridge] 2026-05-08
//
// 借鉴 OpenClaw plugin 的 SecretRef 设计(详见 OPENCODE-PLAN/archive/调研产物/飞书OAuth-2026-05-07/openclaw-lark-架构调研.md):
//
// 三档语义:
//   plaintext  直接 JSON 里存(给 Windows 默认,简单但配置文件读到就拿到)
//   env        JSON 里存 env var 名,运行时 process.env[name] 读(给高级 user 用 1Password CLI 等)
//   file       单独 0600 文件存,JSON 里存绝对 path(给 macOS/Linux 默认,文件分离)
//
// 平台默认:
//   - win32: plaintext(Win 用户多,简单优先)
//   - darwin / linux: file 0600(POSIX 文件权限分离)
//
// 注:不实现 Keychain / DPAPI 集成(留 backlog,跨平台太复杂);user 想要更安全的可走 env 模式接 1Password / pass。

import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from "node:fs"
import { dirname, join } from "node:path"
import { homedir, platform } from "node:os"
import { z } from "zod"

// ============================================================
// Schema
// ============================================================

export const SecretRefSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("plaintext"), value: z.string() }),
  z.object({ type: z.literal("env"), name: z.string().min(1) }),
  z.object({ type: z.literal("file"), path: z.string().min(1) }),
])

export type SecretRef = z.infer<typeof SecretRefSchema>

// ============================================================
// Defaults
// ============================================================

/** 平台默认存储模式 */
export function defaultMode(): SecretRef["type"] {
  return platform() === "win32" ? "plaintext" : "file"
}

/** 默认 file 模式 path:`~/.opencode/feishu-secrets/<id>.key` */
export function defaultFilePath(id: string): string {
  return join(homedir(), ".opencode", "feishu-secrets", `${sanitizeId(id)}.key`)
}

function sanitizeId(id: string): string {
  // 防 path traversal:只允许字母数字 / dash / underscore
  return id.replace(/[^a-zA-Z0-9_-]/g, "_")
}

// ============================================================
// Write / Read
// ============================================================

export interface WriteOptions {
  mode?: SecretRef["type"]
  /** env 模式:env var 名 */
  envName?: string
  /** file 模式:绝对 path,默认 ~/.opencode/feishu-secrets/<id>.key */
  filePath?: string
  /** id:用于 file 模式默认 path 命名(如 appId)*/
  id?: string
}

/**
 * 写凭证。返回 SecretRef(放进配置文件 JSON)。
 *
 * @param secret 明文凭证(写完后 caller 应清空内存中的明文)
 * @param options 存储模式 / 路径覆盖
 */
export function writeSecret(secret: string, options: WriteOptions = {}): SecretRef {
  const mode = options.mode ?? defaultMode()

  if (mode === "plaintext") {
    return { type: "plaintext", value: secret }
  }

  if (mode === "env") {
    const name = options.envName
    if (!name) {
      throw new Error("env mode requires options.envName")
    }
    // 注意:env 模式不实际写 env var(那需要 user shell 配置),只返 ref
    // user 自己负责设置 process.env[name] = secret 或外部工具(1Password CLI 等)注入
    return { type: "env", name }
  }

  if (mode === "file") {
    const path = options.filePath ?? defaultFilePath(options.id ?? "default")
    // 确保目录存在
    const dir = dirname(path)
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true, mode: 0o700 })
    }
    writeFileSync(path, secret, { encoding: "utf-8" })
    // POSIX:0600 单文件分离(Windows 上 chmod 是 no-op)
    if (platform() !== "win32") {
      chmodSync(path, 0o600)
    }
    return { type: "file", path }
  }

  throw new Error(`unknown SecretRef mode: ${mode}`)
}

/**
 * 读凭证。
 *
 * @param ref 配置文件 JSON 里的 SecretRef
 * @returns 明文凭证
 */
export function readSecret(ref: SecretRef): string {
  if (ref.type === "plaintext") {
    return ref.value
  }

  if (ref.type === "env") {
    const value = process.env[ref.name]
    if (value === undefined) {
      throw new Error(`env var ${ref.name} not set`)
    }
    return value
  }

  if (ref.type === "file") {
    if (!existsSync(ref.path)) {
      throw new Error(`secret file not found: ${ref.path}`)
    }
    return readFileSync(ref.path, "utf-8").trim()
  }

  // @ts-expect-error exhaustive check
  throw new Error(`unknown SecretRef type: ${ref.type}`)
}

/**
 * 删除凭证(file 模式删文件;plaintext / env 模式 no-op,caller 应同时从配置移除 ref)。
 */
export function deleteSecret(ref: SecretRef): void {
  if (ref.type !== "file") return
  try {
    const fs = require("node:fs") // eslint-disable-line @typescript-eslint/no-require-imports
    fs.unlinkSync(ref.path)
  } catch {
    // 文件已不存在或权限问题,忽略(idempotent delete)
  }
}
