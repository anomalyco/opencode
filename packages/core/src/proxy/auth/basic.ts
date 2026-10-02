export * as ProxyAuthBasic from "./basic"

import type { ProxyAuthContext, ProxyAuthProvider } from "./provider"

export function basicHeader(username: string, password: string): string {
  return `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`
}

export const basic: ProxyAuthProvider = {
  scheme: "basic",
  step: async (ctx: ProxyAuthContext) => {
    if (ctx.username === undefined) return undefined
    return basicHeader(ctx.username, ctx.password ?? "")
  },
}
