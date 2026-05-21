import { createOpencodeClient } from "@opencode-ai/sdk/v2/client"
import type { ServerConnection } from "@/context/server"

// FORK-BEGIN: 兜底 SDK 的 falsy error fallback,5.11.x + 5.21.x ship 翻车真因
// [feat: sdk-falsy-error-fallback-fix] 2026-05-12 — layer 1: fetch.throw falsy guard
// [feat: sdk-falsy-empty-body-fix]      2026-05-21 — layer 2: response empty body 4xx/5xx guard
//
// 真凶:SDK packages/sdk/js/src/v2/gen/client/client.gen.ts:102 / 220 有 `finalError || ({} as unknown)` —
// 两条触发 path,都会让 `finalError` 在 fallback 时变 `{}`:
//   path A(102 行):底层 fetch 抛 falsy(undefined/null/""/{})→ finalError = e (falsy)→ || ({} as unknown) = {}
//   path B(220 行):fetch 成功但 response 4xx/5xx 且 body 空字符串 ""→ const error = "" ?? "" → finalError = "" → || ({} as string) = {}
// 任一 path 在 throwOnError:true 时 throw {},SolidJS castError 看到非 Error 实例,
// 转 `new Error("Unknown error", {cause: {}})` → ErrorBoundary 渲染"出了点问题 / 原因: {}"空错误页,
// user 完全无 debug 线索。
//
// 本笔在 fetch 边界两层拦截:
//   layer 1(2026-05-12):catch baseFetch.throw,把 falsy reject 转有效 Error("fetch returned empty rejection")
//   layer 2(2026-05-21):fetch 成功后看 response.ok + body length,4xx/5xx + empty body 时
//                       抛 Error("Server returned X with empty body"),SDK 进 catch path 拿到 truthy Error
// SDK 看到的 error 永远 truthy + 有 message,`|| {}` fallback 永远不会被触发 → 永远不抛空对象。
//
// 为什么不直接改 SDK generated 文件:
//   ① `packages/sdk/` 在 .husky/pre-commit 黑名单,需 R4 override + 配额成本(本季已超 3 笔)
//   ② SDK 文件由 @hey-api/openapi-ts auto-generated,下次 regen 时覆盖任何手工 patch
// 选 fork-only `packages/app/src/utils/server.ts`(SDK 实例化唯一入口)落实施,跨所有 createSdkForServer
// 消费者(global-sdk / sync / submit / prompt-input)一处生效。
//
// extract 成 export 函数(2026-05-21)是为了让单测能直接覆盖,见 ./server.test.ts。
export function wrapFetchWithFalsyGuard(
  baseFetch: typeof globalThis.fetch,
): typeof globalThis.fetch {
  return (async (input: Request | string | URL, init?: RequestInit) => {
    let response: Response
    try {
      response = await baseFetch(input as any, init)
    } catch (e) {
      try {
        // 注:Error 对象 Object.keys 返回 [](message/stack 非 enumerable),
        // 不加 `!(e instanceof Error)` 会把有效 Error 错判 empty 转 "empty rejection",
        // 是 5-12 surface fix 留的 latent bug(无线上影响,但错误信息不精确)。本笔顺手修。
        const isEmpty =
          e == null ||
          e === "" ||
          (typeof e === "object" && !(e instanceof Error) && Object.keys(e as object).length === 0)
        if (isEmpty) {
          const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url
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

    // layer 2:4xx/5xx + empty body 兜底(2026-05-21 5.21.x ship 翻车真凶)
    if (!response.ok) {
      let bodyIsEmpty = false
      try {
        const cloned = response.clone()
        const text = await cloned.text()
        bodyIsEmpty = text.length === 0
      } catch (cloneError) {
        // response.clone() / text() 自己挂了不掩盖原 response,继续传给 SDK 走它的正常 path
        console.warn("[FETCH-EMPTY-BODY-CHECK-FAILED]", cloneError)
      }
      if (bodyIsEmpty) {
        const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url
        console.error("[FETCH-EMPTY-BODY-ERROR]", { url, status: response.status })
        throw new Error(`Server returned ${response.status} with empty body: ${url}`)
      }
    }

    return response
  }) as typeof globalThis.fetch
}
// FORK-END

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

  const wrappedFetch = wrapFetchWithFalsyGuard(config.fetch ?? globalThis.fetch)

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
