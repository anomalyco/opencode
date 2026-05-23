// FORK: Phase 1 e2e mock — Tauri invoke dispatch
// [feat: e2e-phase1-mock-mode] 2026-05-23
//
// 接管 `@tauri-apps/api/core` 的 `invoke` export(vite alias 设在 vite/e2e-mock.js)。
//
// W1 D2:最简 stub 让 import 不报错
// W1 D3:critical path 验证 — vite e2e-mock 模式 + page.route 仍能 hydrate(5/6 spec pass)
// W1 D4-D6:dispatch 表 + 22 命令真实接 memfs / 业务 stub(本文件当前状态)
//
// 命令清单全量见 ./MANIFEST.md §一(22 个),按真后端 args / 返回形状对齐。
// args 形状从 packages/app/src grep `invoke<T>("cmd", {...})` 推断,Phase 2 真桌面 contract test 验。

import { memfs } from "./memfs"

// ============== 测试 override 表 ==============
// 让 spec 通过 page.evaluate 注入特定 invoke 行为(如:`get_file_size` 返巨大值触发 large-file-preview)
// 比 memfs.preload 200MB 字符串省内存
const overrides: {
  fileSize: Map<string, number>
} = {
  fileSize: new Map(),
}

// ============== 工具 ==============

function fail(msg: string): never {
  throw new Error(`[e2e-mock-tauri] ${msg}`)
}

function notFound(path: string): never {
  // 对齐真 Tauri command 的"not found"错误形状(io::Error::NotFound → JS Error message)
  throw new Error(`file not found: ${path}`)
}

function b64encode(content: string | Uint8Array): string {
  // 浏览器环境 btoa 只接 latin1 字符串,要先转 Uint8Array
  const bytes = typeof content === "string" ? new TextEncoder().encode(content) : content
  let binary = ""
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])
  return btoa(binary)
}

function b64decode(s: string): Uint8Array {
  const binary = atob(s)
  const out = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i)
  return out
}

// ============== Handler 类型 ==============

type Handler = (args: Record<string, unknown>) => unknown | Promise<unknown>

// ============== fs 核心组(W1 D4-D5)==============

const fsHandlers: Record<string, Handler> = {
  // 参 packages/app/src/pages/session/file-tabs.tsx:445,489,1300
  get_file_mtime: ({ path }) => {
    const p = path as string
    const m = memfs.getMtime(p)
    if (m === null) notFound(p)
    return m
  },

  // 参 packages/app/src/context/file.tsx:207
  get_file_size: ({ path }) => {
    const p = path as string
    // override 优先 — spec 可注入巨大值触发 large-file-preview
    const ov = overrides.fileSize.get(p)
    if (ov !== undefined) return ov
    const s = memfs.getSize(p)
    if (s === null) notFound(p)
    return s
  },

  // 参 file-tabs.tsx:461 — 写 + expectedMtime 冲突检测(对齐真后端行为)
  write_text_file: ({ path, content, expectedMtime }) => {
    const p = path as string
    if (typeof expectedMtime === "number") {
      const cur = memfs.getMtime(p)
      if (cur !== null && cur !== expectedMtime) {
        // 真后端形状:"mtime_conflict" 错误码,前端 saveEdit 据此弹"覆盖 / 重载"
        throw new Error(`mtime_conflict: expected ${expectedMtime}, got ${cur}`)
      }
    }
    memfs.write(p, content as string, "self")
    return undefined
  },

  // 参 md-export-docx.ts:1027
  read_binary_file_base64: ({ path }) => {
    const p = path as string
    const f = memfs.read(p)
    if (!f) notFound(p)
    return b64encode(f.content)
  },

  // 参 file-tree.tsx:818, markdown-editor-extensions.ts:342, md-export-docx.ts:1722
  write_binary_file_absolute_base64: ({ path, base64Content }) => {
    memfs.write(path as string, b64decode(base64Content as string), "self")
    return undefined
  },

  // 参 md-export-docx.ts:1665 — 远程资源,e2e 范围返空 base64(用例需要时再深 mock)
  fetch_url_base64: ({ url }) => {
    console.warn(`[e2e-mock] fetch_url_base64("${url}") — 返空 base64(stub)`)
    return ""
  },
}

// ============== 文件树操作组(W1 D6)==============

const treeHandlers: Record<string, Handler> = {
  // 参 file-tree.tsx:430,514,707,770
  rename_path: ({ from, to }) => {
    const f = from as string
    const t = to as string
    const entry = memfs.read(f)
    if (!entry) notFound(f)
    memfs.write(t, entry.content, "self")
    memfs.delete(f)
    return undefined
  },

  // 参 file-tree.tsx:433
  copy_path: ({ from, to }) => {
    const entry = memfs.read(from as string)
    if (!entry) notFound(from as string)
    memfs.write(to as string, entry.content, "self")
    return undefined
  },

  // 参 file-tree.tsx:538,924
  trash_path: ({ path }) => {
    memfs.delete(path as string)
    return undefined
  },

  // 参 file-tree.tsx:666
  create_empty_file: ({ path }) => {
    if (memfs.exists(path as string)) fail(`already exists: ${path}`)
    memfs.write(path as string, "", "self")
    return undefined
  },

  // 参 file-tree.tsx:683 — memfs 不存目录(用前缀模拟),no-op
  create_directory: ({ path: _path }) => undefined,

  // 参 file-conflict.ts:24 — 简单 if exists → name(1).ext / name(2).ext ...
  next_available_path: ({ dir, name }) => {
    const d = (dir as string).endsWith("/") ? dir : dir + "/"
    let candidate = d + name
    if (!memfs.exists(candidate as string)) return candidate
    const dot = (name as string).lastIndexOf(".")
    const stem = dot > 0 ? (name as string).slice(0, dot) : name
    const ext = dot > 0 ? (name as string).slice(dot) : ""
    for (let i = 1; i < 1000; i++) {
      candidate = `${d}${stem}(${i})${ext}`
      if (!memfs.exists(candidate)) return candidate
    }
    fail(`next_available_path overflow for ${dir}/${name}`)
  },
}

// ============== 外部 app(W1 D6 stub — no-op)==============

const externalHandlers: Record<string, Handler> = {
  // 参 file-too-large.tsx:47,55, file-tabs.tsx:1383,1531
  open_path: ({ path, appName }) => {
    console.warn(`[e2e-mock] open_path("${path}", appName=${appName}) — no-op stub`)
    return undefined
  },

  // 参 file-tree.tsx:954
  reveal_in_folder: ({ path }) => {
    console.warn(`[e2e-mock] reveal_in_folder("${path}") — no-op stub`)
    return undefined
  },
}

// ============== 飞书桥接(W2-stub:返最简化值)==============
// Phase 1 不覆盖飞书桥接 e2e(WSS 事件 mock 难,业务复杂),全部返"未就绪"假数据
const feishuHandlers: Record<string, Handler> = {
  feishu_adapter_status: () => false,

  feishu_oauth_start: ({ domain }) => ({
    sessionId: "e2e-mock-session",
    deviceCode: "e2e-mock-device",
    userCode: "MOCK-1234",
    verificationUri: `https://${domain}.example/oauth`,
    verificationUriComplete: `https://${domain}.example/oauth?code=MOCK-1234`,
    expiresIn: 600,
    interval: 5,
  }),

  feishu_oauth_poll: (_args) => ({
    status: "pending",
    message: "e2e mock — 永远 pending,真实 OAuth 不在 Phase 1 范围",
  }),

  feishu_save_account: ({ appId, openId, domain }) => ({
    accountId: `e2e-mock-${appId}`,
    appId,
    openId,
    domain,
    agent: "imbot",
    botName: "e2e-mock-bot",
  }),

  feishu_list_accounts: () => [],
  feishu_delete_account: () => true,
  feishu_update_account_model: () => true,
  feishu_list_providers: () => JSON.stringify({ providers: [], default: {} }),
}

// ============== 总 dispatch 表 ==============

const HANDLERS: Record<string, Handler> = {
  ...fsHandlers,
  ...treeHandlers,
  ...externalHandlers,
  ...feishuHandlers,
}

// ============== invoke export(被 vite alias 接管)==============

export async function invoke<T = unknown>(command: string, args?: Record<string, unknown>): Promise<T> {
  if (import.meta.env?.VITE_E2E_MOCK !== "true") {
    fail(`invoke("${command}") called outside e2e mock mode — vite plugin alias 漏激活`)
  }
  const handler = HANDLERS[command]
  if (!handler) {
    console.warn(`[e2e-mock] invoke("${command}") — handler not implemented,返 undefined`)
    return undefined as T
  }
  try {
    return (await handler(args ?? {})) as T
  } catch (e) {
    // 把 throw 转成 Tauri 风格 Error(前端 catch 块期望 Error 实例,有 .message)
    if (e instanceof Error) throw e
    throw new Error(typeof e === "string" ? e : JSON.stringify(e))
  }
}

// `@tauri-apps/api/core` 还可能 export 其他 API(Channel / convertFileSrc 等)
export class Channel<T = unknown> {
  onmessage: ((message: T) => void) | null = null
}

export function convertFileSrc(filePath: string, _protocol = "asset"): string {
  return `https://e2e-mock.invalid/${encodeURIComponent(filePath)}`
}

// ============== 暴露 memfs + override + invoke 到 window 给 Playwright fixture 用 ==============
// fixtures.ts 通过 page.evaluate 调:
//   - `window.__deskfoxE2eMemfs.preload(...)` 同步数据
//   - `window.__deskfoxE2eOverride.setFileSize(path, size)` 注入特定 invoke 行为
//   - `window.__deskfoxE2eInvoke(cmd, args)` 直接调 Tauri invoke(绕过 dynamic import resolve 问题)
if (import.meta.env?.VITE_E2E_MOCK === "true" && typeof window !== "undefined") {
  ;(window as unknown as { __deskfoxE2eMemfs: typeof memfs }).__deskfoxE2eMemfs = memfs
  ;(window as unknown as { __deskfoxE2eOverride: { setFileSize(p: string, n: number): void; reset(): void } }).__deskfoxE2eOverride = {
    setFileSize: (path: string, size: number) => overrides.fileSize.set(path, size),
    reset: () => overrides.fileSize.clear(),
  }
  ;(window as unknown as { __deskfoxE2eInvoke: typeof invoke }).__deskfoxE2eInvoke = invoke
}
