/**
 * ============================================================================
 * 文件名：common.tsx
 * 所属包：packages/console/app/src/routes/workspace
 * ============================================================================
 *
 * 文件作用：
 * 工作区页面通用工具函数和查询。提供工作区相关公共功能。
 *
 * 主要功能：
 * - 日期格式化工具
 * - 余额格式化工具
 * - 获取上次访问的工作区
 * - 查询会话信息（管理员权限、Beta 测试资格）
 * - 生成 Stripe 支付结账 URL
 * - 查询账单信息
 *
 * 依赖关系：
 * - @opencode-ai/console-resource：资源访问（获取应用配置）
 * - @opencode-ai/console-core：核心功能模块
 * - @solidjs/router：路由查询和动作
 * - ~/context/auth.withActor：Actor 上下文包装器
 *
 * 导出内容：
 * - formatDateForTable：格式化日期用于表格显示
 * - formatDateUTC：格式化 UTC 日期
 * - formatBalance：格式化余额（微美分转美元）
 * - getLastSeenWorkspaceID：获取上次访问的工作区 ID
 * - querySessionInfo：查询会话信息
 * - createCheckoutUrl：生成 Stripe 结账 URL 的动作
 * - queryBillingInfo：查询账单信息
 *
 * @package console.app
 * @module workspace/common
 */

// 导入资源访问模块
import { Resource } from "@opencode-ai/console-resource"

// 导入 Actor 上下文管理
import { Actor } from "@opencode-ai/console-core/actor.js"

// 导入路由工具
import { action, json, query } from "@solidjs/router"

// 导入 Actor 上下文包装器
import { withActor } from "~/context/auth.withActor"

// 导入账单管理
import { Billing } from "@opencode-ai/console-core/billing.js"

// 导入用户管理
import { User } from "@opencode-ai/console-core/user.js"

// 导入 Drizzle ORM 操作符和数据库
import { and, Database, desc, eq, isNull } from "@opencode-ai/console-core/drizzle/index.js"

// 导入工作区数据表模型
import { WorkspaceTable } from "@opencode-ai/console-core/schema/workspace.sql.js"

// 导入用户数据表模型
import { UserTable } from "@opencode-ai/console-core/schema/user.sql.js"

/**
 * 格式化日期用于表格显示
 *
 * 将日期格式化为简短的日期时间字符串，适合在表格中显示。
 *
 * @param date - 要格式化的日期
 * @returns 格式化后的日期字符串（如 "Jan 15, 3:45 PM"）
 *
 * @example
 * formatDateForTable(new Date("2024-01-15T15:45:00Z"))
 * // 返回 "Jan 15, 3:45 PM"
 */
export function formatDateForTable(date: Date) {
  // 定义日期格式选项
  const options: Intl.DateTimeFormatOptions = {
    day: "numeric",      // 数字日期（如 15）
    month: "short",      // 短月份名（如 Jan）
    hour: "numeric",     // 数字小时（12 小时制）
    minute: "2-digit",   // 两位数分钟（如 45）
    hour12: true,        // 使用 12 小时制
  }
  // 使用本地化格式化日期，并将逗号替换为逗号（不变）
  return date.toLocaleDateString(undefined, options).replace(",", ",")
}

/**
 * 格式化 UTC 日期
 *
 * 将日期格式化为完整的 UTC 日期时间字符串，包含时区信息。
 *
 * @param date - 要格式化的日期
 * @returns 格式化后的 UTC 日期字符串（如 "Mon, Jan 15, 2024, 3:45:30 PM UTC"）
 *
 * @example
 * formatDateUTC(new Date("2024-01-15T15:45:30Z"))
 * // 返回 "Mon, Jan 15, 2024, 3:45:30 PM UTC"
 */
export function formatDateUTC(date: Date) {
  // 定义日期格式选项
  const options: Intl.DateTimeFormatOptions = {
    weekday: "short",    // 短星期名（如 Mon）
    year: "numeric",     // 数字年份（如 2024）
    month: "short",      // 短月份名（如 Jan）
    day: "numeric",      // 数字日期（如 15）
    hour: "numeric",     // 数字小时（12 小时制）
    minute: "2-digit",   // 两位数分钟
    second: "2-digit",   // 两位数秒数
    timeZoneName: "short", // 短时区名（如 UTC）
    timeZone: "UTC",     // 使用 UTC 时区
  }
  // 使用美式英语格式化日期
  return date.toLocaleDateString("en-US", options)
}

/**
 * 格式化余额
 *
 * 将余额从微美分转换为美元格式。
 *
 * 单位换算：
 * - 1 美元 = 100 美分
 * - 1 美分 = 1,000,000 微美分
 * - 1 美元 = 100,000,000 微美分
 *
 * @param amount - 余额金额（微美分）
 * @returns 格式化后的美元字符串（保留两位小数）
 *
 * @example
 * formatBalance(100000000)  // 1 美元
 * // 返回 "1.00"
 *
 * formatBalance(-50000000)  // -0.5 美元
 * // 返回 "-0.50"
 *
 * formatBalance(0)
 * // 返回 "0.00"
 */
export function formatBalance(amount: number) {
  // 将微美分转换为美元，保留两位小数
  const balance = ((amount ?? 0) / 100000000).toFixed(2)
  // 如果结果是 "-0.00"，返回 "0.00"
  return balance === "-0.00" ? "0.00" : balance
}

/**
 * 获取上次访问的工作区 ID
 *
 * 服务端函数，根据用户最近访问时间获取工作区 ID。
 * 用于在用户访问 /auth 时自动重定向到上次访问的工作区。
 *
 * @returns 上次访问的工作区 ID，如果没有则返回 undefined
 *
 * 服务端标记：
 * - "use server"：标记为服务端函数
 *
 * 查询逻辑：
 * - 从 UserTable 和 WorkspaceTable 关联查询
 * - 筛选当前账户的用户记录
 * - 按最近访问时间倒序排序
 * - 返回第一条记录的工作区 ID
 */
export async function getLastSeenWorkspaceID() {
  // 标记为服务端函数
  "use server"
  // 使用 Actor 上下文执行查询
  return withActor(async () => {
    // 断言为账户级别的 Actor
    const actor = Actor.assert("account")
    return Database.use(async (tx) =>
      tx
        // 选择工作区 ID
        .select({ id: WorkspaceTable.id })
        // 从用户表开始
        .from(UserTable)
        // 关联工作区表
        .innerJoin(WorkspaceTable, eq(UserTable.workspaceID, WorkspaceTable.id))
        // 筛选条件
        .where(
          and(
            // 属于当前账户
            eq(UserTable.accountID, actor.properties.accountID),
            // 用户未删除
            isNull(UserTable.timeDeleted),
            // 工作区未删除
            isNull(WorkspaceTable.timeDeleted),
          ),
        )
        // 按最近访问时间倒序排序（最近的在前）
        .orderBy(desc(UserTable.timeSeen))
        // 只取第一条记录
        .limit(1)
        // 返回工作区 ID
        .then((x) => x[0]?.id),
    )
  })
}

/**
 * 查询会话信息
 *
 * 服务端查询函数，获取当前用户在指定工作区的会话信息。
 * 包括管理员权限和 Beta 测试资格。
 *
 * @param workspaceID - 工作区 ID
 * @returns 会话信息对象
 *
 * 服务端标记：
 * - "use server"：标记为服务端函数
 *
 * 返回数据格式：
 * ```typescript
 * {
 *   isAdmin: boolean,  // 是否为管理员
 *   isBeta: boolean    // 是否为 Beta 测试用户
 * }
 * ```
 *
 * Beta 测试资格：
 * - 生产环境：只有特定工作区 ID 有 Beta 资格
 * - 非生产环境：所有工作区都有 Beta 资格
 */
export const querySessionInfo = query(async (workspaceID: string) => {
  // 标记为服务端函数
  "use server"
  // 使用 Actor 上下文执行查询
  return withActor(() => {
    return {
      // 检查用户是否为管理员
      isAdmin: Actor.userRole() === "admin",
      // 检查是否为 Beta 测试用户
      // 生产环境：只有特定工作区有 Beta 资格
      // 非生产环境：所有工作区都有 Beta 资格
      isBeta: Resource.App.stage === "production" ? workspaceID === "wrk_01K46JDFR0E75SG2Q8K172KF3Y" : true,
    }
  }, workspaceID)
}, "session.get")

/**
 * 生成 Stripe 支付结账 URL
 *
 * 服务端动作，生成 Stripe Checkout 会话 URL 用于用户充值。
 *
 * @param workspaceID - 工作区 ID
 * @param amount - 充值金额（美元）
 * @param successUrl - 支付成功后的跳转 URL
 * @param cancelUrl - 取消支付后的跳转 URL
 * @returns 包含结账 URL 或错误信息的 JSON 响应
 *
 * 服务端标记：
 * - "use server"：标记为服务端函数
 *
 * 返回数据格式：
 * ```typescript
 * 成功：
 * { error: undefined, data: string }  // data 是 Stripe Checkout URL
 *
 * 失败：
 * { error: string, data: undefined }  // error 是错误消息
 * ```
 */
export const createCheckoutUrl = action(
  async (workspaceID: string, amount: number, successUrl: string, cancelUrl: string) => {
    // 标记为服务端函数
    "use server"
    // 返回 JSON 响应
    return json(
      await withActor(
        () =>
          Billing.generateCheckoutUrl({ amount, successUrl, cancelUrl })
            // 成功：返回结账 URL
            .then((data) => ({ error: undefined, data }))
            // 失败：返回错误消息
            .catch((e) => ({
              error: e.message as string,
              data: undefined,
            })),
        workspaceID,
      ),
    )
  },
  "checkoutUrl",
)

/**
 * 查询账单信息
 *
 * 服务端查询函数，获取工作区的账单配置和状态。
 *
 * @param workspaceID - 工作区 ID
 * @returns 账单信息对象
 *
 * 服务端标记：
 * - "use server"：标记为服务端函数
 *
 * 返回数据格式：
 * ```typescript
 * {
 *   customerID: string,           // Stripe 客户 ID
 *   subscriptionID: string,       // Stripe 订阅 ID
 *   paymentMethodID: string,      // 支付方式 ID
 *   paymentMethodType: string,    // 支付方式类型
 *   paymentMethodLast4: string,   // 支付方式后四位
 *   balance: number,              // 当前余额（微美分）
 *   reload: boolean,              // 是否启用自动充值
 *   reloadAmount: number,         // 自动充值金额（美元）
 *   reloadTrigger: number,        // 自动充值触发余额（美元）
 *   monthlyLimit: number,         // 月度限额（微美分）
 *   monthlyUsage: number,         // 当前月度使用量（微美分）
 *   reloadAmountMin: number,      // 最小充值金额
 *   reloadTriggerMin: number,     // 最小充值触发余额
 *   // ... 其他字段
 * }
 * ```
 */
export const queryBillingInfo = query(async (workspaceID: string) => {
  // 标记为服务端函数
  "use server"
  // 使用 Actor 上下文执行查询
  return withActor(async () => {
    // 获取账单信息
    const billing = await Billing.get()
    return {
      // 展开所有账单字段
      ...billing,
      // 如果未设置自动充值金额，使用默认值
      reloadAmount: billing.reloadAmount ?? Billing.RELOAD_AMOUNT,
      // 最小充值金额常量
      reloadAmountMin: Billing.RELOAD_AMOUNT_MIN,
      // 如果未设置自动充值触发余额，使用默认值
      reloadTrigger: billing.reloadTrigger ?? Billing.RELOAD_TRIGGER,
      // 最小充值触发余额常量
      reloadTriggerMin: Billing.RELOAD_TRIGGER_MIN,
    }
  }, workspaceID)
}, "billing.get")
