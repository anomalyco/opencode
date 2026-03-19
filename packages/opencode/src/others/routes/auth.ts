import { Hono } from "hono"
import { describeRoute, validator, resolver } from "hono-openapi"
import z from "zod"
import { Accounts, Token, getCurrentUser } from "../auth"
import { LoginRequestSchema, LoginResponseSchema } from "../auth/types"
import { errors } from "@/server/error"

/**
 * 认证路由
 * 处理登录、登出、验证等请求
 */
export function AuthRoutes() {
  const app = new Hono()

  /**
   * POST /others/auth/login
   * 用户登录
   */
  app.post(
    "/login",
    describeRoute({
      summary: "User login",
      description: "Authenticate user with username and password, returns a JWT token on success",
      operationId: "auth.login",
      responses: {
        200: {
          description: "Login successful",
          content: {
            "application/json": {
              schema: resolver(LoginResponseSchema),
            },
          },
        },
        401: {
          description: "Invalid credentials",
          content: {
            "application/json": {
              schema: resolver(
                z.object({
                  success: z.literal(false),
                  message: z.string(),
                }),
              ),
            },
          },
        },
        ...errors(400),
      },
    }),
    validator("json", LoginRequestSchema),
    async (c) => {
      const { username, password } = c.req.valid("json")

      // 验证账号密码
      const account = await Accounts.verify(username, password)
      if (!account) {
        return c.json(
          {
            success: false,
            message: "Invalid username or password",
          },
          401,
        )
      }

      // 生成 Token
      const token = await Token.generate({
        username: account.username,
        permissions: account.permissions,
        workspace: account.workspace,
      })

      return c.json({
        success: true,
        token,
        user: {
          username: account.username,
          permissions: account.permissions,
          workspace: account.workspace,
        },
      })
    },
  )

  /**
   * POST /others/auth/logout
   * 用户登出 (客户端清除 token 即可)
   */
  app.post(
    "/logout",
    describeRoute({
      summary: "User logout",
      description: "Logout user (client should clear the token)",
      operationId: "auth.logout",
      responses: {
        200: {
          description: "Logout successful",
          content: {
            "application/json": {
              schema: resolver(z.object({ success: z.literal(true) })),
            },
          },
        },
      },
    }),
    async (c) => {
      // JWT 是无状态的，服务端不需要维护 session
      // 客户端只需清除本地存储的 token 即可
      return c.json({ success: true })
    },
  )

  /**
   * GET /others/auth/me
   * 获取当前登录用户信息
   */
  app.get(
    "/me",
    describeRoute({
      summary: "Get current user",
      description: "Get the currently authenticated user's information",
      operationId: "auth.me",
      responses: {
        200: {
          description: "User information",
          content: {
            "application/json": {
              schema: resolver(
                z.object({
                  success: z.literal(true),
                  user: z.object({
                    username: z.string(),
                    permissions: z.array(z.string()),
                    workspace: z.string().optional(),
                  }),
                }),
              ),
            },
          },
        },
        401: {
          description: "Not authenticated",
          content: {
            "application/json": {
              schema: resolver(
                z.object({
                  success: z.literal(false),
                  message: z.string(),
                }),
              ),
            },
          },
        },
      },
    }),
    async (c) => {
      // 这个接口需要认证中间件保护
      const user = getCurrentUser(c)
      if (!user) {
        return c.json(
          {
            success: false,
            message: "Not authenticated",
          },
          401,
        )
      }

      return c.json({
        success: true,
        user: {
          username: user.username,
          permissions: user.permissions,
          workspace: user.workspace,
        },
      })
    },
  )

  /**
   * GET /others/auth/verify
   * 验证 token 是否有效
   */
  app.get(
    "/verify",
    describeRoute({
      summary: "Verify token",
      description: "Verify if the provided token is valid",
      operationId: "auth.verify",
      responses: {
        200: {
          description: "Token verification result",
          content: {
            "application/json": {
              schema: resolver(
                z.object({
                  valid: z.boolean(),
                  user: z
                    .object({
                      username: z.string(),
                      permissions: z.array(z.string()),
                      workspace: z.string().optional(),
                    })
                    .optional(),
                }),
              ),
            },
          },
        },
      },
    }),
    async (c) => {
      // 从 Authorization header 获取 token
      const authHeader = c.req.header("Authorization")
      if (!authHeader?.startsWith("Bearer ")) {
        return c.json({ valid: false })
      }

      const token = authHeader.slice(7)
      const user = await Token.extractUser(token)

      if (!user) {
        return c.json({ valid: false })
      }

      return c.json({
        valid: true,
        user: {
          username: user.username,
          permissions: user.permissions,
          workspace: user.workspace,
        },
      })
    },
  )

  /**
   * GET /others/auth/status
   * 获取认证系统状态 (公开接口)
   */
  app.get(
    "/status",
    describeRoute({
      summary: "Get auth status",
      description: "Check if authentication is enabled and configured",
      operationId: "auth.status",
      responses: {
        200: {
          description: "Auth status",
          content: {
            "application/json": {
              schema: resolver(
                z.object({
                  enabled: z.boolean(),
                  hasAccounts: z.boolean(),
                }),
              ),
            },
          },
        },
      },
    }),
    async (c) => {
      const accounts = await Accounts.loadAll()
      return c.json({
        enabled: true,
        hasAccounts: accounts.length > 0,
      })
    },
  )

  return app
}
