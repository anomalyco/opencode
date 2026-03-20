import z from "zod"

/**
 * 用户账号信息
 */
export const AccountSchema = z.object({
  username: z.string(),
  password: z.string(),
  role: z.string().default("user"),
  enabled: z.boolean().default(true),
  space_path: z.string(),
  permissions: z.array(z.string()).default([]),
  workspace: z.string().optional(),
})

export type Account = z.infer<typeof AccountSchema>

/**
 * 账号文件格式 (数组)
 */
export const AccountsFileSchema = z.array(AccountSchema)

export type AccountsFile = z.infer<typeof AccountsFileSchema>

/**
 * JWT Token 载荷
 */
export const TokenPayloadSchema = z.object({
  username: z.string(),
  role: z.string(),
  enabled: z.boolean(),
  space_path: z.string(),
  permissions: z.array(z.string()),
  workspace: z.string().optional(),
  iat: z.number(),
  exp: z.number(),
})

export type TokenPayload = z.infer<typeof TokenPayloadSchema>

/**
 * 登录请求
 */
export const LoginRequestSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
})

export type LoginRequest = z.infer<typeof LoginRequestSchema>

/**
 * 登录响应
 */
export const LoginResponseSchema = z.object({
  success: z.boolean(),
  token: z.string().optional(),
  user: z
    .object({
      username: z.string(),
      role: z.string(),
      enabled: z.boolean(),
      space_path: z.string(),
      permissions: z.array(z.string()),
      workspace: z.string().optional(),
    })
    .optional(),
  message: z.string().optional(),
})

export type LoginResponse = z.infer<typeof LoginResponseSchema>

/**
 * 用户信息 (存储在 context 中)
 */
export interface UserInfo {
  username: string
  role: string
  enabled: boolean
  space_path: string
  permissions: string[]
  workspace?: string
}
