/**
 * ============================================================================
 * 文件名：auth.ts
 * 所属包：packages/console/function/src
 * ============================================================================
 *
 * 文件作用：
 * OpenCode 控制台的身份认证云函数。
 * 处理 OAuth 登录流程（GitHub、Google），创建账户和工作区。
 *
 * 主要功能：
 * - 集成 OpenAuth.js 处理 OAuth 流程
 * - 支持 GitHub 和 Google OAuth 登录
 * - 自动创建账户和工作区
 * - 关联多个 OAuth 提供商到同一账户
 * - 处理工作区邀请
 *
 * 依赖关系：
 * - @cloudflare/workers-types：Cloudflare Workers 类型
 * - zod：运行时类型验证
 * - @openauthjs/openauth：OpenAuth.js 认证框架
 * - @opencode-ai/console-core：核心业务逻辑
 * - @opencode-ai/console-resource：资源访问
 *
 * 导出内容：
 * - default：Cloudflare Worker 导出对象
 * - subjects：认证主体定义
 *
 * 使用场景：
 * - 用户登录到 OpenCode 控制台
 * - OAuth 回调处理
 *
 * @package console.function
 * @module auth
 */

// 导入 Cloudflare KV 类型定义
import type { KVNamespace } from "@cloudflare/workers-types"

// 导入 Zod 类型验证库
import { z } from "zod"

// 导入 OpenAuth.js 核心功能
// issuer：创建认证服务器
import { issuer } from "@openauthjs/openauth"

// 导入 OpenAuth 主题类型
import type { Theme } from "@openauthjs/openauth/ui/theme"

// 导入主体创建函数
// subjects 定义认证后的用户身份类型
import { createSubjects } from "@openauthjs/openauth/subject"

// 导入默认主题
import { THEME_OPENAUTH } from "@openauthjs/openauth/ui/theme"

// 导入 GitHub OAuth 提供商
import { GithubProvider } from "@openauthjs/openauth/provider/github"

// 导入 Google OIDC 提供商
import { GoogleOidcProvider } from "@openauthjs/openauth/provider/google"

// 导入 Cloudflare KV 存储适配器
import { CloudflareStorage } from "@openauthjs/openauth/storage/cloudflare"

// 导入核心业务模块
import { Account } from "@opencode-ai/console-core/account.js"
import { Workspace } from "@opencode-ai/console-core/workspace.js"
import { Actor } from "@opencode-ai/console-core/actor.js"
import { User } from "@opencode-ai/console-core/user.js"

// 导入数据库模块
import { and, Database, eq, isNull, or } from "@opencode-ai/console-core/drizzle/index.js"

// 导入数据表模型
import { WorkspaceTable } from "@opencode-ai/console-core/schema/workspace.sql.js"
import { UserTable } from "@opencode-ai/console-core/schema/user.sql.js"
import { AuthTable } from "@opencode-ai/console-core/schema/auth.sql.js"

// 导入标识符生成工具
import { Identifier } from "@opencode-ai/console-core/identifier.js"

/**
 * 环境变量类型定义
 *
 * 定义 Cloudflare Worker 需要的环境绑定。
 */
type Env = {
  // 认证存储的 KV 命名空间
  // 用于存储 OAuth 会话和状态
  AuthStorage: KVNamespace
}

/**
 * 认证主体定义
 *
 * 定义系统中的两种主体类型：
 * - account：全局账户（跨工作区）
 * - user：工作区用户（特定于工作区）
 */
export const subjects = createSubjects({
  // 账户主体
  // 表示全局唯一的账户
  account: z.object({
    // 账户 ID
    accountID: z.string(),
    // 账户邮箱
    email: z.string(),
  }),

  // 用户主体
  // 表示特定工作区中的用户
  user: z.object({
    // 用户 ID
    userID: z.string(),
    // 所属工作区 ID
    workspaceID: z.string(),
  }),
})

/**
 * 自定义主题配置
 *
 * 基于默认主题，添加自定义 Logo。
 */
const MY_THEME: Theme = {
  // 继承默认主题的所有配置
  ...THEME_OPENAUTH,
  // 使用 OpenCode 的 Logo
  logo: "https://opencode.ai/favicon.svg",
}

/**
 * 默认导出：Cloudflare Worker
 *
 * 处理认证请求的入口点。
 */
export default {
  /**
   * fetch 方法
   *
   * Cloudflare Worker 的请求处理函数。
   *
   * @param request - HTTP 请求对象
   * @param env - 环境变量和绑定
   * @param ctx - 执行上下文
   * @returns HTTP 响应
   */
  async fetch(request: Request, env: Env, ctx: ExecutionContext) {
    // 创建 OpenAuth.js 认证服务器
    const result = await issuer({
      // 使用自定义主题
      theme: MY_THEME,

      // 配置 OAuth 提供商
      providers: {
        // GitHub OAuth 提供商
        github: GithubProvider({
          // 从资源中获取 GitHub Client ID
          clientID: Resource.GITHUB_CLIENT_ID_CONSOLE.value,
          // 从资源中获取 GitHub Client Secret
          clientSecret: Resource.GITHUB_CLIENT_SECRET_CONSOLE.value,
          // 请求的权限范围
          // read:user：读取用户信息
          // user:email：读取用户邮箱
          scopes: ["read:user", "user:email"],
        }),

        // Google OIDC 提供商
        google: GoogleOidcProvider({
          // 从资源中获取 Google Client ID
          clientID: Resource.GOOGLE_CLIENT_ID.value,
          // 请求的权限范围
          // openid：OpenID Connect
          // email：获取邮箱
          scopes: ["openid", "email"],
        }),

        // 邮箱验证提供商（已注释）
        // 这是一个使用验证码的邮箱认证方式
        //        email: CodeProvider({
        //          // 处理认证请求
        //          async request(req, state, form, error) {
        //            console.log(state)
        //            const params = new URLSearchParams()
        //            if (error) {
        //              params.set("error", error.type)
        //            }
        //            if (state.type === "start") {
        //              // 开始认证流程，重定向到邮箱输入页面
        //              return Response.redirect(process.env.AUTH_FRONTEND_URL + "/auth/email?" + params.toString(), 302)
        //            }
        //
        //            if (state.type === "code") {
        //              // 验证码输入阶段
        //              return Response.redirect(process.env.AUTH_FRONTEND_URL + "/auth/code?" + params.toString(), 302)
        //            }
        //
        //            return new Response("ok")
        //          },
        //          // 发送验证码
        //          async sendCode(claims, code) {
        //            const email = z.string().email().parse(claims.email)
        //            const cmd = new SendEmailCommand({
        //              Destination: {
        //                ToAddresses: [email],
        //              },
        //              FromEmailAddress: `SST <auth@${Resource.Email.sender}>`,
        //              Content: {
        //                Simple: {
        //                  Body: {
        //                    Html: {
        //                      Data: `Your pin code is <strong>${code}</strong>`,
        //                    },
        //                    Text: {
        //                      Data: `Your pin code is ${code}`,
        //                    },
        //                  },
        //                  Subject: {
        //                    Data: "SST Console Pin Code: " + code,
        //                  },
        //                },
        //              },
        //            })
        //            await ses.send(cmd)
        //          },
        //        }),
      },

      // 配置存储后端
      // 使用 Cloudflare KV 存储 OAuth 会话
      storage: CloudflareStorage({
        // @ts-ignore - KV 类型与 OpenAuth 期望的类型不完全匹配
        namespace: env.AuthStorage,
      }),

      // 传入主体定义
      subjects,

      // 认证成功后的回调
      async success(ctx, response) {
        // 打印响应用于调试
        console.log(response)

        // 声明变量用于存储用户信息
        let subject: string | undefined  // 提供商的用户 ID
        let email: string | undefined     // 用户邮箱

        // 根据不同的提供商处理用户信息
        if (response.provider === "github") {
          // GitHub 认证：需要调用 GitHub API 获取用户信息
          // 获取用户的邮箱列表
          const emails = (await fetch("https://api.github.com/user/emails", {
            headers: {
              // 使用 access token 认证
              Authorization: `Bearer ${response.tokenset.access}`,
              // GitHub API 要求提供 User-Agent
              "User-Agent": "opencode",
              // 指定 API 版本
              Accept: "application/vnd.github+json",
            },
          }).then((x) => x.json())) as any

          // 获取用户基本信息
          const user = (await fetch("https://api.github.com/user", {
            headers: {
              Authorization: `Bearer ${response.tokenset.access}`,
              "User-Agent": "opencode",
              Accept: "application/vnd.github+json",
            },
          }).then((x) => x.json())) as any

          // 使用 GitHub 用户 ID 作为 subject
          subject = user.id.toString()

          // 查找主邮箱
          const primaryEmail = emails.find((x: any) => x.primary)
          // 必须有主邮箱
          if (!primaryEmail) throw new Error("No primary email found for GitHub user")
          // 主邮箱必须已验证
          if (!primaryEmail.verified) throw new Error("Primary email for GitHub user not verified")
          email = primaryEmail.email

        } else if (response.provider === "google") {
          // Google 认证：邮箱信息已在 id token 中
          // 检查邮箱是否已验证
          if (!response.id.email_verified) throw new Error("Google email not verified")
          // sub 是 Google 用户的唯一标识符
          subject = response.id.sub as string
          // email 是用户邮箱
          email = response.id.email as string

        } else {
          // 不支持的提供商
          throw new Error("Unsupported provider")
        }

        // 验证必要信息
        if (!email) throw new Error("No email found")
        if (!subject) throw new Error("No subject found")

        // 非生产环境只允许特定域名邮箱登录
        if (Resource.App.stage !== "production" && !email.endsWith("@anoma.ly")) {
          throw new Error("Invalid email")
        }

        // 获取或创建账户
        const accountID = await (async () => {
          // 查询数据库，查找已存在的账户关联
          const matches = await Database.use(async (tx) =>
            tx
              // 选择提供商和账户 ID
              .select({
                provider: AuthTable.provider,
                accountID: AuthTable.accountID,
              })
              .from(AuthTable)
              .where(
                or(
                  // 匹配当前提供商的 subject
                  and(eq(AuthTable.provider, response.provider), eq(AuthTable.subject, subject)),
                  // 匹配邮箱（用于关联不同提供商的同一账户）
                  and(eq(AuthTable.provider, "email"), eq(AuthTable.subject, email)),
                ),
              ),
          )

          // 获取通过提供商找到的账户 ID
          const idByProvider = matches.find((x) => x.provider === response.provider)?.accountID
          // 获取通过邮箱找到的账户 ID
          const idByEmail = matches.find((x) => x.provider === "email")?.accountID

          // 如果两个都存在，说明账户已经关联，返回该 ID
          if (idByProvider && idByEmail) return idByProvider

          // 账户不存在或未完全关联，需要处理
          let accountID = idByProvider ?? idByEmail

          // 如果账户不存在，创建新账户
          if (!accountID) {
            console.log("creating account for", email)
            accountID = await Account.create({})
          }

          // 保存或更新认证关联
          await Database.use(async (tx) =>
            tx
              // 插入两条记录：
              // 1. 提供商 -> 账户关联
              // 2. 邮箱 -> 账户关联
              .insert(AuthTable)
              .values([
                {
                  id: Identifier.create("auth"),
                  accountID,
                  provider: response.provider,
                  subject,
                },
                {
                  id: Identifier.create("auth"),
                  accountID,
                  provider: "email",
                  subject: email,
                },
              ])
              // 如果记录已存在（软删除），恢复它
              .onDuplicateKeyUpdate({
                set: {
                  timeDeleted: null,
                },
              }),
          )

          return accountID
        })()

        // 获取或创建工作区
        // 在账户上下文中执行操作
        await Actor.provide("account", { accountID, email }, async () => {
          // 加入被邀请的工作区
          await User.joinInvitedWorkspaces()

          // 查询用户已加入的工作区
          const workspaces = await Database.use((tx) =>
            tx
              .select({ id: WorkspaceTable.id })
              .from(WorkspaceTable)
              // 关联用户表，筛选属于该用户的工作区
              .innerJoin(UserTable, eq(UserTable.workspaceID, WorkspaceTable.id))
              .where(
                and(
                  // 匹配账户 ID
                  eq(UserTable.accountID, accountID),
                  // 用户未被删除
                  isNull(UserTable.timeDeleted),
                  // 工作区未被删除
                  isNull(WorkspaceTable.timeDeleted),
                ),
              ),
          )

          // 如果没有任何工作区，创建默认工作区
          if (workspaces.length === 0) {
            await Workspace.create({ name: "Default" })
          }
        })

        // 返回账户主体
        // OpenAuth 会使用这个信息生成 JWT token
        return ctx.subject("account", accountID, { accountID, email })
      },
    }).fetch(request, env, ctx)

    // 返回认证结果
    return result
  },
}
