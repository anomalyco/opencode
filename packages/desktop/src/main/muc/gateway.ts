// MUC Harness: Gateway Base URL 常量。
// 默认 HTTPS（正式发布）；开发期可用 MUC_GATEWAY_URL 覆盖（允许 HTTP）。
// 该常量与 opencode 核心（packages/opencode/src/provider/muc.ts）保持一致。

const DEFAULT_GATEWAY = "http://admin.wuxuexi.top"

export function mucGatewayBaseURL(): string {
  const raw = process.env.MUC_GATEWAY_URL?.trim() || DEFAULT_GATEWAY
  return raw.replace(/\/+$/, "")
}
