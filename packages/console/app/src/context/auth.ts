/**
 * ============================================================================
 * 文件名：auth.ts
 * 所属包：packages/console/app/src/context
 * ============================================================================
 *
 * 文件作用：
 * 认证上下文管理模块。处理用户认证、会话管理和 Actor 权限上下文。
 *
 * 主要功能：
 * - 创建 OpenAuth 客户端
 * - 管理认证会话
 * - 获取当前用户的 Actor 信息（权限上下文）
 * - 处理多账户和工作区切换
 *
 * 依赖关系：
 * - solid-js/web：SolidJS Web 工具
 * - @opencode-ai/console-core/drizzle：数据库 ORM
 * - @opencode-ai/console-core/schema/user.sql：用户数据表
 * - @solidjs/router：路由管理
 * - @opencode-ai/console-core/actor：Actor 权限上下文
 * - @openauthjs/openauth/client：OpenAuth 客户端
 * - @solidjs/start/http：HTTP 会话管理
 * - @opencode-ai/console-resource：资源配置
 *
 * 导出内容：
 * - AuthClient：OpenAuth 客户端实例
 * - AuthSession：认证会话接口
 * - useAuthSession：认证会话 Hook
 * - getActor：获取 Actor 信息的函数
 *
 * @package console.app
 * @module auth
 */

// 导入请求事件获取工具
import { getRequestEvent } from "solid-js/web"

// 导入 Drizzle ORM 操作符和数据库
import { and, Database, eq, inArray, isNull, sql } from "@opencode-ai/console-core/drizzle/index.js"

// 导入用户数据表模型
import { UserTable } from "@opencode-ai/console-core/schema/user.sql.js"

// 导入重定向函数
import { redirect } from "@solidjs/router"

// 导入 Actor 权限上下文
import { Actor } from "@opencode-ai/console-core/actor.js"

// 导入 OpenAuth 客户端创建工具
import { createClient } from "@openauthjs/openauth/client"

/**
 * OpenAuth 客户端
 *
 * 配置 OpenAuth.js 客户端用于处理 OAuth 认证流程。
 */
export const AuthClient = createClient({
  // 客户端 ID（标识应用）
  clientID: "app",
  // 认证服务器 URL（从环境变量获取）
  issuer: import.meta.env.VITE_AUTH_URL,
})

// 导入会话管理 Hook
import { useSession } from "@solidjs/start/http"

// 导入资源配置
import { Resource } from "@opencode-ai/console-resource"

/**
 * 认证会话接口
 *
 * 定义认证会话的数据结构。
 */
export interface AuthSession {
  // 账户映射（键为账户 ID，值为账户信息）
  account?: Record<
    string,
    {
      // 账户 ID
      id: string
      // 邮箱地址
      email: string
    }
  >
  // 当前选中的账户 ID
  current?: string
}

/**
 * 认证会话 Hook
 *
 * 创建或获取认证会话。
 *
 * @returns 会话对象，包含 data、update 等方法
 *
 * 配置说明：
 * - password：会话加密密钥（防止篡改）
 * - name：会话名称
 * - maxAge：会话有效期（365 天）
 * - cookie：Cookie 配置
 */
export function useAuthSession() {
  return useSession<AuthSession>({
    // 会话加密密钥（从资源获取）
    password: Resource.ZEN_SESSION_SECRET.value,
    // 会话名称
    name: "auth",
    // 会话有效期：365 天
    maxAge: 60 * 60 * 24 * 365,
    // Cookie 配置
    cookie: {
      // 不强制 HTTPS（开发模式需要）
      secure: false,
      // 仅 HTTP 访问（防止 XSS）
      httpOnly: true,
    },
  })
}

/**
 * 获取 Actor 信息
 *
 * 根据认证会话和工作区 ID 获取当前用户的 Actor 权限上下文。
 * 支持三种 Actor 类型：
 * 1. account：账户级别（全局，无工作区上下文）
 * 2. user：用户级别（工作区特定）
 * 3. public：匿名访问
 *
 * @param workspace - 可选的工作区 ID
 * @returns Actor 信息对象
 *
 * @example
 * ```typescript
 * // 获取账户级别的 Actor
 * const actor = await getActor()
 *
 * // 获取工作区特定的 Actor
 * const actor = await getActor("wrk_123")
 * ```
 */
export const getActor = async (workspace?: string): Promise<Actor.Info> => {
  // 标记为服务端函数
  "use server"
  // 获取当前请求事件
  const evt = getRequestEvent()
  // 如果没有请求事件，抛出错误
  if (!evt) throw new Error("No request event")
  // 如果 Actor 已缓存，直接返回
  if (evt.locals.actor) return evt.locals.actor

  // 异步计算 Actor 信息并缓存
  evt.locals.actor = (async () => {
    // 获取认证会话
    const auth = await useAuthSession()

    // 如果没有指定工作区，返回账户级别的 Actor
    if (!workspace) {
      // 获取账户信息
      const account = auth.data.account ?? {}
      // 获取当前选中的账户
      const current = account[auth.data.current ?? ""]

      // 如果有当前账户，返回账户 Actor
      if (current) {
        return {
          // 账户类型
          type: "account",
          properties: {
            // 邮箱
            email: current.email,
            // 账户 ID
            accountID: current.id,
          },
        }
      }

      // 如果没有当前账户但有账户列表，选择第一个
      if (Object.keys(account).length > 0) {
        const current = Object.values(account)[0]
        // 更新会话，设置为当前账户
        await auth.update((val) => ({
          ...val,
          current: current.id,
        }))
        return {
          type: "account",
          properties: {
            email: current.email,
            accountID: current.id,
          },
        })
      }

      // 没有账户，返回公开 Actor
      return {
        type: "public",
        properties: {},
      }
    }

    // 有工作区 ID，查找工作区用户
    const accounts = Object.keys(auth.data.account ?? {})
    if (accounts.length) {
      // 在数据库中查找用户
      const user = await Database.use((tx) =>
        tx
          .select()
          .from(UserTable)
          .where(
            and(
              // 匹配工作区 ID
              eq(UserTable.workspaceID, workspace),
              // 未删除
              isNull(UserTable.timeDeleted),
              // 账户 ID 在已认证账户列表中
              inArray(UserTable.accountID, accounts),
            ),
          )
          .limit(1)
          .execute()
          .then((x) => x[0]),
      )

      // 如果找到用户，返回用户 Actor
      if (user) {
        // 更新用户最后活跃时间
        await Database.use((tx) =>
          tx
            .update(UserTable)
            .set({ timeSeen: sql`now()` })
            .where(and(eq(UserTable.workspaceID, workspace), eq(UserTable.id, user.id))),
        )
        return {
          type: "user",
          properties: {
            userID: user.id,
            workspaceID: user.workspaceID,
            accountID: user.accountID,
            role: user.role,
          },
        }
      }
    }

    // 未找到用户，重定向到授权页面
    throw redirect("/auth/authorize")
  })()

  // 返回缓存的 Actor
  return evt.locals.actor
}
