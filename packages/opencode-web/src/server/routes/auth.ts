import { Hono } from "hono"
import { zValidator } from "@hono/zod-validator"
import { z } from "zod"
import { HTTPException } from "hono/http-exception"
import { eq } from "drizzle-orm"
import { nanoid } from "nanoid"
import { db, schema } from "../../db/client"
import { hashPassword, verifyPassword, hashToken } from "../../auth/password"
import { signAccessToken, signRefreshToken, verifyToken, getRefreshTokenExpiry } from "../../auth/jwt"
import { authMiddleware } from "../../auth/middleware"

const registerSchema = z.object({
  email: z.string().email("Invalid email address"),
  password: z.string().min(8, "Password must be at least 8 characters"),
  name: z.string().max(255).optional(),
})

const loginSchema = z.object({
  email: z.string().email("Invalid email address"),
  password: z.string().min(1, "Password is required"),
})

const refreshSchema = z.object({
  refreshToken: z.string().min(1, "Refresh token is required"),
})

export function AuthRoutes() {
  return new Hono()
    // Register
    .post("/register", zValidator("json", registerSchema), async (c) => {
      const { email, password, name } = c.req.valid("json")

      // Check if user already exists
      const existingUser = await db.query.users.findFirst({
        where: eq(schema.users.email, email),
      })

      if (existingUser) {
        throw new HTTPException(409, { message: "Email already registered" })
      }

      // Hash password and create user
      const passwordHash = await hashPassword(password)
      const [user] = await db
        .insert(schema.users)
        .values({
          email,
          passwordHash,
          name,
        })
        .returning({ id: schema.users.id, email: schema.users.email })

      // Generate tokens
      const accessToken = await signAccessToken({ userId: user.id, email: user.email })
      const refreshToken = await signRefreshToken({ userId: user.id, email: user.email })

      // Store refresh token hash
      await db.insert(schema.refreshTokens).values({
        userId: user.id,
        tokenHash: hashToken(refreshToken),
        expiresAt: getRefreshTokenExpiry(),
      })

      return c.json({
        user: {
          id: user.id,
          email: user.email,
          name,
        },
        accessToken,
        refreshToken,
      })
    })

    // Login
    .post("/login", zValidator("json", loginSchema), async (c) => {
      const { email, password } = c.req.valid("json")

      // Find user
      const user = await db.query.users.findFirst({
        where: eq(schema.users.email, email),
      })

      if (!user) {
        throw new HTTPException(401, { message: "Invalid email or password" })
      }

      // Verify password
      const isValid = await verifyPassword(password, user.passwordHash)
      if (!isValid) {
        throw new HTTPException(401, { message: "Invalid email or password" })
      }

      // Generate tokens
      const accessToken = await signAccessToken({ userId: user.id, email: user.email })
      const refreshToken = await signRefreshToken({ userId: user.id, email: user.email })

      // Store refresh token hash
      await db.insert(schema.refreshTokens).values({
        userId: user.id,
        tokenHash: hashToken(refreshToken),
        expiresAt: getRefreshTokenExpiry(),
      })

      return c.json({
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
        },
        accessToken,
        refreshToken,
      })
    })

    // Refresh token
    .post("/refresh", zValidator("json", refreshSchema), async (c) => {
      const { refreshToken } = c.req.valid("json")

      // Verify refresh token
      let payload
      try {
        payload = await verifyToken(refreshToken)
        if (payload.type !== "refresh") {
          throw new Error("Invalid token type")
        }
      } catch {
        throw new HTTPException(401, { message: "Invalid refresh token" })
      }

      // Check if refresh token exists in database
      const tokenHash = hashToken(refreshToken)
      const storedToken = await db.query.refreshTokens.findFirst({
        where: eq(schema.refreshTokens.tokenHash, tokenHash),
      })

      if (!storedToken || storedToken.expiresAt < new Date()) {
        throw new HTTPException(401, { message: "Refresh token expired or revoked" })
      }

      // Delete old refresh token
      await db.delete(schema.refreshTokens).where(eq(schema.refreshTokens.tokenHash, tokenHash))

      // Find user
      const user = await db.query.users.findFirst({
        where: eq(schema.users.id, payload.userId),
      })

      if (!user) {
        throw new HTTPException(401, { message: "User not found" })
      }

      // Generate new tokens
      const newAccessToken = await signAccessToken({ userId: user.id, email: user.email })
      const newRefreshToken = await signRefreshToken({ userId: user.id, email: user.email })

      // Store new refresh token hash
      await db.insert(schema.refreshTokens).values({
        userId: user.id,
        tokenHash: hashToken(newRefreshToken),
        expiresAt: getRefreshTokenExpiry(),
      })

      return c.json({
        accessToken: newAccessToken,
        refreshToken: newRefreshToken,
      })
    })

    // Logout (revoke refresh token)
    .post("/logout", authMiddleware, zValidator("json", refreshSchema), async (c) => {
      const { refreshToken } = c.req.valid("json")
      const tokenHash = hashToken(refreshToken)

      // Delete refresh token
      await db.delete(schema.refreshTokens).where(eq(schema.refreshTokens.tokenHash, tokenHash))

      return c.json({ success: true })
    })

    // Get current user
    .get("/me", authMiddleware, async (c) => {
      const { userId } = c.get("user")

      const user = await db.query.users.findFirst({
        where: eq(schema.users.id, userId),
        columns: {
          id: true,
          email: true,
          name: true,
          settings: true,
          createdAt: true,
        },
      })

      if (!user) {
        throw new HTTPException(404, { message: "User not found" })
      }

      return c.json({ user })
    })
}
