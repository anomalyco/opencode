import { SignJWT, jwtVerify, type JWTPayload } from "jose"
import { config } from "../config"

const secret = new TextEncoder().encode(config.JWT_SECRET)

export interface TokenPayload extends JWTPayload {
  userId: string
  email: string
  type: "access" | "refresh"
}

function parseDuration(duration: string): number {
  const match = duration.match(/^(\d+)([smhd])$/)
  if (!match) {
    throw new Error(`Invalid duration format: ${duration}`)
  }
  const value = parseInt(match[1], 10)
  const unit = match[2]
  switch (unit) {
    case "s":
      return value
    case "m":
      return value * 60
    case "h":
      return value * 60 * 60
    case "d":
      return value * 60 * 60 * 24
    default:
      throw new Error(`Unknown duration unit: ${unit}`)
  }
}

export async function signAccessToken(payload: { userId: string; email: string }): Promise<string> {
  const expiresIn = parseDuration(config.JWT_EXPIRES_IN)

  return new SignJWT({ ...payload, type: "access" } as TokenPayload)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${expiresIn}s`)
    .setIssuer("opencode-web")
    .sign(secret)
}

export async function signRefreshToken(payload: { userId: string; email: string }): Promise<string> {
  const expiresIn = parseDuration(config.JWT_REFRESH_EXPIRES_IN)

  return new SignJWT({ ...payload, type: "refresh" } as TokenPayload)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${expiresIn}s`)
    .setIssuer("opencode-web")
    .sign(secret)
}

export async function verifyToken(token: string): Promise<TokenPayload> {
  try {
    const { payload } = await jwtVerify(token, secret, {
      issuer: "opencode-web",
    })
    return payload as TokenPayload
  } catch (error) {
    throw new Error("Invalid or expired token")
  }
}

export function getRefreshTokenExpiry(): Date {
  const expiresIn = parseDuration(config.JWT_REFRESH_EXPIRES_IN)
  return new Date(Date.now() + expiresIn * 1000)
}
