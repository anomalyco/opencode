// FORK: Phase 1 e2e mock — Tauri invoke stub
// [feat: e2e-phase1-mock-mode] 2026-05-23
//
// 接管 `@tauri-apps/api/core` 的 `invoke` export(vite alias 在 vite/e2e-mock.js 设)。
//
// W1 D2 范围:**最简 stub** — 所有 invoke 调用 console.warn 提示 + 返 undefined,
// 让前端代码 import 不报错、调用不立即崩,但行为是"假的"。
// 真实命令实现 W1 D4-D6 按 `e2e/mocks/MANIFEST.md` 逐个填(挂内存 fs / 业务 stub)。
//
// 22 个待实现命令清单见 ./MANIFEST.md §一。

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function invoke<T = unknown>(command: string, _args?: unknown): Promise<T> {
  // 全局开关:用 import.meta.env 而非 process.env(前端 bundle 无 process.env)
  // VITE_E2E_MOCK 由 vite/e2e-mock.js 的 plugin define hook 注入
  if (import.meta.env?.VITE_E2E_MOCK !== "true") {
    throw new Error(
      `[e2e-mock] invoke("${command}") called outside e2e mock mode — ` +
        `检查 vite plugin alias 是否漏激活`,
    )
  }
  console.warn(`[e2e-mock] invoke("${command}") — W1 D2 stub,返 undefined(W1 D4+ 实现)`)
  return undefined as T
}

// `@tauri-apps/api/core` 还可能 export 其他 API(Channel / convertFileSrc 等),
// 真实代码用到时 W1 D6 buffer 补;W1 D2 范围只关 invoke。
export class Channel<T = unknown> {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  onmessage: ((message: T) => void) | null = null
}

export function convertFileSrc(filePath: string, _protocol = "asset"): string {
  return `https://e2e-mock.invalid/${encodeURIComponent(filePath)}`
}
