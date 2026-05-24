import { fileURLToPath } from "node:url"

/**
 * FORK: Phase 1 e2e mock vite plugin
 * [feat: e2e-phase1-mock-mode] 2026-05-23
 *
 * 仅在以下任一条件激活,否则 plugin 返 false vite 自动跳过:
 *   - 启动命令带 `--mode e2e-mock`(npm script `dev:e2e-mock`/`test:e2e:mock`)
 *   - 环境变量 `VITE_E2E_MOCK=true`
 *
 * 激活后:
 *   - alias `@tauri-apps/api/core` → `e2e/mocks/tauri.ts`(invoke 全栈 mock)
 *   - inject `import.meta.env.VITE_E2E_MOCK = "true"` 让前端代码可检测 e2e 模式
 *
 * W1 D2 范围:plugin 框架 + 拦 `@tauri-apps/api/core` 让 import 不报错
 * W1 D3+: SDK 拦截 + 内存 fs 注入,让 UI hydrate
 * 详 docs/features/e2e-phase1-mock-mode/2-plan.md
 *
 * @type {() => import("vite").PluginOption}
 */
export default function e2eMockPlugin() {
  const tauriMockPath = fileURLToPath(new URL("../e2e/mocks/tauri.ts", import.meta.url))

  return {
    name: "deskfox-e2e-mock",
    enforce: "pre",
    config(_config, env) {
      const isE2eMock = process.env.VITE_E2E_MOCK === "true" || env.mode === "e2e-mock"
      if (!isE2eMock) return

      // 用 console.warn 高亮模式开启 — 防止误以为是 prod build
      console.warn("[deskfox-e2e-mock] Phase 1 mock mode ACTIVE — Tauri invoke / SDK 走 mock,不连真后端")

      return {
        resolve: {
          alias: {
            "@tauri-apps/api/core": tauriMockPath,
          },
        },
        define: {
          "import.meta.env.VITE_E2E_MOCK": JSON.stringify("true"),
        },
        // FORK: vite 启动时主动预编译热文件,缓解冷启动 + 多 worker 并行时第 1 批 spec timeout
        // [feat: e2e-vite-warmup] 2026-05-23 — 双保险方案 D(globalSetup 走方案 A)
        server: {
          warmup: {
            clientFiles: [
              "./src/entry.tsx",
              "./src/pages/session.tsx",
              "./src/pages/session/session-side-panel.tsx",
              "./src/pages/session/file-tabs.tsx",
              "./src/components/file-tree.tsx",
              "./src/components/prompt-input.tsx",
              "./src/components/file-too-large.tsx",
              "./src/context/file.tsx",
            ],
          },
        },
      }
    },
  }
}
