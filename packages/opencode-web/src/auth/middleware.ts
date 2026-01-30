import { createMiddleware } from "hono/factory"
import { HTTPException } from "hono/http-exception"
import { verifyToken, type TokenPayload } from "./jwt"

// Extend Hono context with user info
declare module "hono" {
  interface ContextVariableMap {
    user: {
      userId: string
      email: string
    }
  }
}

export const authMiddleware = createMiddleware(async (c, next) => {
  const authHeader = c.req.header("Authorization")

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    throw new HTTPException(401, { message: "Missing or invalid authorization header" })
  }

  const token = authHeader.slice(7) // Remove "Bearer " prefix

  try {
    const payload = await verifyToken(token)

    if (payload.type !== "access") {
      throw new HTTPException(401, { message: "Invalid token type" })
    }

    c.set("user", {
      userId: payload.userId,
      email: payload.email,
    })

    await next()
  } catch (error) {
    if (error instanceof HTTPException) {
      throw error
    }
    throw new HTTPException(401, { message: "Invalid or expired token" })
  }
})

// Optional auth middleware - doesn't throw if no token
export const optionalAuthMiddleware = createMiddleware(async (c, next) => {
  const authHeader = c.req.header("Authorization")

  if (authHeader?.startsWith("Bearer ")) {
    const token = authHeader.slice(7)
    try {
      const payload = await verifyToken(token)
      if (payload.type === "access") {
        c.set("user", {
          userId: payload.userId,
          email: payload.email,
        })
      }
    } catch {
      // Ignore invalid tokens in optional auth
    }
  }

  await next()
})
