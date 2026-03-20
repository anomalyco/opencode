import { Log } from "@/util/log"
import type { TokenPayload, UserInfo } from "./types"

const log = Log.create({ service: "auth.token" })

/**
 * Token 管理模块
 * 使用 HMAC-SHA256 实现简单的 JWT
 */
export namespace Token {
  // Token 有效期 (7天)
  const EXPIRES_IN_SECONDS = 7 * 24 * 60 * 60

  // 使用环境变量或默认密钥
  const getSecret = (): string => {
    return process.env.OPENCODE_AUTH_SECRET || "opencode-default-secret-key-change-in-production"
  }

  /**
   * Base64URL 编码
   */
  function base64UrlEncode(data: string): string {
    return Buffer.from(data)
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "")
  }

  /**
   * Base64URL 解码
   */
  function base64UrlDecode(str: string): string {
    str = str.replace(/-/g, "+").replace(/_/g, "/")
    while (str.length % 4) str += "="
    return Buffer.from(str, "base64").toString("utf-8")
  }

  /**
   * 生成 HMAC-SHA256 签名
   */
  async function sign(data: string, secret: string): Promise<string> {
    const encoder = new TextEncoder()
    const key = await crypto.subtle.importKey(
      "raw",
      encoder.encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    )
    const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(data))
    return Buffer.from(signature).toString("base64url")
  }

  /**
   * 验证 HMAC-SHA256 签名
   */
  async function verifySignature(data: string, signature: string, secret: string): Promise<boolean> {
    const expectedSignature = await sign(data, secret)
    return signature === expectedSignature
  }

  /**
   * 生成 Token
   */
  export async function generate(user: UserInfo): Promise<string> {
    const now = Math.floor(Date.now() / 1000)
    const payload: TokenPayload = {
      username: user.username,
      role: user.role,
      enabled: user.enabled,
      space_path: user.space_path,
      permissions: user.permissions,
      workspace: user.workspace,
      iat: now,
      exp: now + EXPIRES_IN_SECONDS,
    }

    const header = base64UrlEncode(JSON.stringify({ alg: "HS256", typ: "JWT" }))
    const payloadEncoded = base64UrlEncode(JSON.stringify(payload))
    const signature = await sign(`${header}.${payloadEncoded}`, getSecret())

    return `${header}.${payloadEncoded}.${signature}`
  }

  /**
   * 验证并解析 Token
   * @returns 验证成功返回 TokenPayload，失败返回 null
   */
  export async function verify(token: string): Promise<TokenPayload | null> {
    try {
      const parts = token.split(".")
      if (parts.length !== 3) {
        log.warn("Invalid token format")
        return null
      }

      const [headerEncoded, payloadEncoded, signature] = parts

      // 验证签名
      const isValid = await verifySignature(`${headerEncoded}.${payloadEncoded}`, signature, getSecret())
      if (!isValid) {
        log.warn("Invalid token signature")
        return null
      }

      // 解析 payload
      const payloadJson = base64UrlDecode(payloadEncoded)
      const payload = JSON.parse(payloadJson) as TokenPayload

      // 检查过期时间
      const now = Math.floor(Date.now() / 1000)
      if (payload.exp < now) {
        log.warn("Token expired", { exp: payload.exp, now })
        return null
      }

      return payload
    } catch (error) {
      log.error("Failed to verify token", { error })
      return null
    }
  }

  /**
   * 从 Token 提取用户信息
   */
  export async function extractUser(token: string): Promise<UserInfo | null> {
    const payload = await verify(token)
    if (!payload) return null

    return {
      username: payload.username,
      role: payload.role,
      enabled: payload.enabled,
      space_path: payload.space_path,
      permissions: payload.permissions,
      workspace: payload.workspace,
    }
  }
}
