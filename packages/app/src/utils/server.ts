import { createOpencodeClient } from "@opencode-ai/sdk/v2/client"
import type { ServerConnection } from "@/context/server"

export function createSdkForServer({
  server,
  ...config
}: Omit<NonNullable<Parameters<typeof createOpencodeClient>[0]>, "baseUrl"> & {
  server: ServerConnection.HttpBase
}) {
  const auth = (() => {
    if (!server.password) return
    return {
      Authorization: `Basic ${btoa(`${server.username ?? "opencode"}:${server.password}`)}`,
    }
  })()

  // FORK-BEGIN: 兜底 SDK 的 falsy error fallback,5.11.x ship 翻车真因 [feat: sdk-falsy-error-fallback-fix] 2026-05-12
  // 真凶:SDK packages/sdk/js/src/v2/gen/client/client.gen.ts:102 / 220 有 `finalError || ({} as unknown)` —
  // 当底层 fetch(Tauri tauriFetch / 浏览器 native fetch / interceptor)抛 falsy(undefined/null/"")时
  // fallback 抛空对象 `{}`。SolidJS castError 看到非 Error 实例,转 `new Error("Unknown error", {cause: {}})` →
  // ErrorBoundary 渲染"出了点问题 / 原因: {}"错误页,user 完全无 debug 线索。
  //
  // 本笔在 fetch 边界拦截 — 包一层把 falsy reject 转有效 Error,SDK 看到的 error 永远 truthy +
  // 有 message,SDK 的 `|| {}` fallback 永远不会被触发 → 永远不抛空对象。
  //
  // 为什么不直接改 SDK generated 文件:
  //   ① `packages/sdk/` 在 .husky/pre-commit 黑名单,需 R4 override + 配额成本(本季已超 3 笔)
  //   ② SDK 文件由 @hey-api/openapi-ts auto-generated,下次 regen 时覆盖任何手工 patch
  // 选 fork-only `packages/app/src/utils/server.ts`(SDK 实例化唯一入口)落实施,跨所有 createSdkForServer
  // 消费者(global-sdk / sync / submit / prompt-input)一处生效。
  const baseFetch = config.fetch ?? globalThis.fetch
  const wrappedFetch = (async (input: Request, init?: RequestInit) => {
    try {
      return await baseFetch(input, init)
    } catch (e) {
      try {
        const isEmpty = e == null || (typeof e === "object" && Object.keys(e as object).length === 0)
        if (isEmpty) {
          const url = typeof input === "string" ? input : input.url
          console.error("[FETCH-FALSY-REJECTION]", { url, originalError: e })
          throw new Error(`fetch returned empty rejection: ${url}`)
        }
      } catch (guardError) {
        // 兜底守卫自己挂掉时不能掩盖原 error,继续抛 original
        if (guardError instanceof Error && guardError.message.startsWith("fetch returned empty rejection")) {
          throw guardError
        }
        console.error("[FETCH-FALSY-GUARD-FAILED]", guardError)
      }
      throw e
    }
  }) as typeof baseFetch
  // FORK-END

  return createOpencodeClient({
    ...config,
    fetch: wrappedFetch,
    headers: {
      ...(config.headers instanceof Headers ? Object.fromEntries(config.headers.entries()) : config.headers),
      ...auth,
    },
    baseUrl: server.url,
  })
}
