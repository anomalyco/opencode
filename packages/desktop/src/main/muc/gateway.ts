// 校园 Harness: Gateway Base URL（品牌档案驱动）。
// muc 默认 admin.wuxuexi.top；hubu 默认 http://localhost:8081（本地开发）。
// 开发期可用 <BRAND>_GATEWAY_URL 覆盖（允许 HTTP）。
// 默认值与 opencode 核心（packages/opencode/src/provider/muc.ts）保持一致。

import { resolveBrand } from "@opencode-ai/brand"

const brand = resolveBrand()
const DEFAULT_GATEWAY = brand.gatewayURL || "http://admin.wuxuexi.top"

export function mucGatewayBaseURL(): string {
  const raw = process.env[brand.gatewayEnvVar]?.trim() || DEFAULT_GATEWAY
  return raw.replace(/\/+$/, "")
}
