// FORK: stale session error 识别 helper [feat: frontend-stale-session-fallback] 2026-05-21
//
// 用途:identify "session 不存在/已 archive/无权限" 类的 HTTP error,让启动恢复路径
// (`directory-layout.tsx` 的 createResource)能区分:
//   - stale session error → navigate 去掉 stale session id,降级到主界面
//   - 其他 error(网络断 / sidecar 没起 / 5xx 服务故障)→ 仍 throw,让 ErrorBoundary 处理
//
// 当前识别来源:
//   1. wrapFetchWithFalsyGuard layer 2 ([feat: sdk-falsy-empty-body-fix] 2026-05-21)
//      sidecar 返 4xx + empty body 时抛:`Server returned ${status} with empty body: ${url}`
//      只 match 401/404(其他 4xx 如 403 也算 stale 但暂不展开,后续如有需求扩 regex)
//
// 5xx 不视为 stale(可能是 sidecar 临时挂,user retry 应能恢复)。
// 网络断 / TypeError / AbortError 不视为 stale。

export function isStaleSessionError(e: unknown): boolean {
  if (!(e instanceof Error)) return false
  // [feat: sdk-falsy-empty-body-fix] wrapFetchWithFalsyGuard 抛的格式
  if (/^Server returned 40[14] with empty body:/.test(e.message)) return true
  return false
}
