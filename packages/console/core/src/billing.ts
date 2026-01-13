/**
 * ============================================================================
 * 文件名：billing.ts
 * 所属包：packages/console/core/src
 * ============================================================================
 *
 * 文件作用：
 * 账单和支付管理模块。集成 Stripe 处理支付、账单和使用情况追踪。
 *
 * 主要功能：
 * - 获取工作区账单信息
 * - 查询支付历史
 * - 查询使用情况
 * - 余额自动充值
 * - 授予额度
 * - 设置月度限额
 * - 生成支付结账 URL
 * - 生成 Stripe Portal 会话 URL
 * - 生成收据 URL
 *
 * 依赖关系：
 * - stripe：Stripe SDK
 * - ./drizzle：数据库连接
 * - ./schema/billing.sql：账单数据表模型
 * - ./actor：Actor 上下文管理
 * - ./util/fn：函数包装工具
 * - zod：运行时类型验证
 * - @opencode-ai/console-resource：资源访问
 * - ./identifier：ID 生成工具
 * - ./util/price：价格转换工具
 * - ./user：用户管理
 *
 * 导出内容：
 * - Billing.get：获取账单信息
 * - Billing.payments：查询支付历史
 * - Billing.usages：查询使用情况
 * - Billing.reload：执行余额充值
 * - Billing.grantCredit：授予额度
 * - Billing.setMonthlyLimit：设置月度限额
 * - Billing.generateCheckoutUrl：生成支付结账 URL
 * - Billing.generateSessionUrl：生成 Portal 会话 URL
 * - Billing.generateReceiptUrl：生成收据 URL
 * - Billing.ITEM_CREDIT_NAME：Stripe 项目名称（额度）
 * - Billing.ITEM_FEE_NAME：Stripe 项目名称（手续费）
 * - Billing.RELOAD_AMOUNT：默认充值金额（$20）
 * - Billing.RELOAD_AMOUNT_MIN：最小充值金额（$10）
 * - Billing.RELOAD_TRIGGER：默认充值触发余额（$5）
 * - Billing.RELOAD_TRIGGER_MIN：最小充值触发余额（$5）
 * - Billing.stripe：Stripe 客户端
 * - Billing.calculateFeeInCents：计算手续费
 *
 * 使用场景：
 * - 用户充值
 * - 余额自动充值
 * - 账单管理界面
 * - 支付历史查询
 *
 * @package console.core
 * @module billing
 */

// 导入 Stripe SDK
import { Stripe } from "stripe"

// 导入 Drizzle ORM 操作符和数据库
import { Database, eq, sql } from "./drizzle"

// 导入账单相关数据表模型
import { BillingTable, PaymentTable, UsageTable } from "./schema/billing.sql"

// 导入 Actor 上下文管理
import { Actor } from "./actor"

// 导入函数包装工具
import { fn } from "./util/fn"

// 导入 Zod 类型验证库
import { z } from "zod"

// 导入资源访问模块
import { Resource } from "@opencode-ai/console-resource"

// 导入标识符生成工具
import { Identifier } from "./identifier"

// 导入价格转换工具
import { centsToMicroCents } from "./util/price"

// 导入用户管理
import { User } from "./user"

/**
 * Billing 命名空间
 *
 * 包含所有账单和支付相关的操作函数。
 */
export namespace Billing {
  // Stripe 发票项目名称：额度
  export const ITEM_CREDIT_NAME = "opencode credits"

  // Stripe 发票项目名称：手续费
  export const ITEM_FEE_NAME = "processing fee"

  // 默认自动充值金额（美元）
  export const RELOAD_AMOUNT = 20

  // 最小充值金额（美元）
  export const RELOAD_AMOUNT_MIN = 10

  // 默认自动充值触发余额（美元）
  // 当余额低于此值时自动充值
  export const RELOAD_TRIGGER = 5

  // 最小自动充值触发余额（美元）
  export const RELOAD_TRIGGER_MIN = 5

  /**
   * Stripe 客户端
   *
   * 创建并返回配置好的 Stripe 客户端实例。
   *
   * @returns Stripe 客户端
   */
  export const stripe = () =>
    new Stripe(Resource.STRIPE_SECRET_KEY.value, {
      // Stripe API 版本
      apiVersion: "2025-03-31.basil",
      // 使用 Fetch HTTP 客户端
      httpClient: Stripe.createFetchHttpClient(),
    })

  /**
   * 获取账单信息
   *
   * 获取当前工作区的账单配置和状态。
   *
   * @returns 账单信息对象
   *
   * @example
   * ```typescript
   * const billing = await Billing.get()
   * console.log(billing.balance)     // 余额（微美分）
   * console.log(billing.reloadAmount) // 自动充值金额
   * ```
   */
  export const get = async () => {
    return Database.use(async (tx) =>
      tx
        .select({
          // Stripe 客户 ID
          customerID: BillingTable.customerID,
          // Stripe 订阅 ID
          subscriptionID: BillingTable.subscriptionID,
          // 支付方式 ID
          paymentMethodID: BillingTable.paymentMethodID,
          // 支付方式类型
          paymentMethodType: BillingTable.paymentMethodType,
          // 支付方式后四位
          paymentMethodLast4: BillingTable.paymentMethodLast4,
          // 当前余额（微美分）
          balance: BillingTable.balance,
          // 是否启用自动充值
          reload: BillingTable.reload,
          // 自动充值金额
          reloadAmount: BillingTable.reloadAmount,
          // 自动充值触发余额
          reloadTrigger: BillingTable.reloadTrigger,
          // 月度限额
          monthlyLimit: BillingTable.monthlyLimit,
          // 当前月度使用量
          monthlyUsage: BillingTable.monthlyUsage,
          // 月度使用量更新时间
          timeMonthlyUsageUpdated: BillingTable.timeMonthlyUsageUpdated,
          // 最近充值错误
          reloadError: BillingTable.reloadError,
          // 充值错误时间
          timeReloadError: BillingTable.timeReloadError,
        })
        .from(BillingTable)
        // 筛选当前工作区
        .where(eq(BillingTable.workspaceID, Actor.workspace()))
        // 取第一条记录
        .then((r) => r[0]),
    )
  }

  /**
   * 查询支付历史
   *
   * 获取当前工作区的支付记录列表。
   *
   * @returns 支付记录列表（最多 100 条）
   *
   * @example
   * ```typescript
   * const payments = await Billing.payments()
   * // 返回按创建时间倒序的支付记录
   * ```
   */
  export const payments = async () => {
    return await Database.use((tx) =>
      tx
        .select()
        .from(PaymentTable)
        // 筛选当前工作区
        .where(eq(PaymentTable.workspaceID, Actor.workspace()))
        // 按创建时间倒序排序
        .orderBy(sql`${PaymentTable.timeCreated} DESC`)
        // 最多返回 100 条
        .limit(100),
    )
  }

  /**
   * 查询使用情况
   *
   * 分页获取当前工作区的使用记录。
   *
   * @param page - 页码（从 0 开始）
   * @param pageSize - 每页大小（默认 50）
   * @returns 使用记录列表
   *
   * @example
   * ```typescript
   * // 第一页，每页 50 条
   * const usagePage1 = await Billing.usages(0, 50)
   *
   * // 第二页
   * const usagePage2 = await Billing.usages(1, 50)
   * ```
   */
  export const usages = async (page = 0, pageSize = 50) => {
    return await Database.use((tx) =>
      tx
        .select()
        .from(UsageTable)
        // 筛选当前工作区
        .where(eq(UsageTable.workspaceID, Actor.workspace()))
        // 按创建时间倒序排序
        .orderBy(sql`${UsageTable.timeCreated} DESC`)
        // 限制返回数量
        .limit(pageSize)
        // 跳过前面的记录
        .offset(page * pageSize),
    )
  }

  /**
   * 计算手续费
   *
   * 计算 Stripe 收取的手续费。
   * Stripe 费率：4.4% + $0.30
   *
   * 计算公式：
   * 目标金额 x = 总金额 - 手续费
   * x = total - (total * 0.044 + 0.30)
   * x = total * 0.956 - 0.30
   * total = (x + 0.30) / 0.956
   * 手续费 = total * 0.044 + 0.30
   *
   * @param x - 目标金额（美分）
   * @returns 手续费（美分）
   *
   * @example
   * ```typescript
   * const fee = Billing.calculateFeeInCents(1000) // $10.00
   * // 返回 74，表示 $0.74 手续费
   * ```
   */
  export const calculateFeeInCents = (x: number) => {
    // 根据上述公式计算手续费
    return Math.round(((x + 30) / 0.956) * 0.044 + 30)
  }

  /**
   * 执行余额充值
   *
   * 使用保存的支付方式向 Stripe 发起充值。
   * 创建发票、添加项目、完成支付并更新余额。
   *
   * @example
   * ```typescript
   * await Billing.reload()
   * ```
   */
  export const reload = async () => {
    // 查询账单配置
    const billing = await Database.use((tx) =>
      tx
        .select({
          // Stripe 客户 ID
          customerID: BillingTable.customerID,
          // 支付方式 ID
          paymentMethodID: BillingTable.paymentMethodID,
          // 自动充值金额
          reloadAmount: BillingTable.reloadAmount,
        })
        .from(BillingTable)
        // 筛选当前工作区
        .where(eq(BillingTable.workspaceID, Actor.workspace()))
        // 取第一条记录
        .then((rows) => rows[0]),
    )

    const customerID = billing.customerID
    const paymentMethodID = billing.paymentMethodID
    // 充值金额（美分）
    const amountInCents = (billing.reloadAmount ?? Billing.RELOAD_AMOUNT) * 100
    // 生成支付记录 ID
    const paymentID = Identifier.create("payment")

    let invoice

    try {
      // 创建 Stripe 发票草稿
      const draft = await Billing.stripe().invoices.create({
        customer: customerID!,
        // 不自动完成（需要手动 finalize）
        auto_advance: false,
        // 默认支付方式
        default_payment_method: paymentMethodID!,
        // 自动扣款
        collection_method: "charge_automatically",
        // 美元
        currency: "usd",
      })

      // 添加额度项目
      await Billing.stripe().invoiceItems.create({
        amount: amountInCents,
        currency: "usd",
        customer: customerID!,
        invoice: draft.id!,
        description: ITEM_CREDIT_NAME,
      })

      // 添加手续费项目
      await Billing.stripe().invoiceItems.create({
        amount: calculateFeeInCents(amountInCents),
        currency: "usd",
        customer: customerID!,
        invoice: draft.id!,
        description: ITEM_FEE_NAME,
      })

      // 完成发票
      await Billing.stripe().invoices.finalizeInvoice(draft.id!)

      // 支付发票
      invoice = await Billing.stripe().invoices.pay(draft.id!, {
        // 离线支付（保存支付方式用于未来支付）
        off_session: true,
        // 使用指定的支付方式
        payment_method: paymentMethodID!,
        // 扩展返回支付信息
        expand: ["payments"],
      })

      // 验证支付状态
      if (invoice.status !== "paid" || invoice.payments?.data.length !== 1)
        throw new Error(invoice.last_finalization_error?.message)

    } catch (e: any) {
      // 支付失败，记录错误
      console.error(e)

      await Database.use((tx) =>
        tx
          .update(BillingTable)
          .set({
            // 保存错误信息
            reloadError: e.message ?? "Payment failed.",
            // 记录错误时间
            timeReloadError: sql`now()`,
          })
          .where(eq(BillingTable.workspaceID, Actor.workspace())),
      )

      // 提前返回，不继续处理
      return
    }

    // 支付成功，更新余额并记录支付
    await Database.transaction(async (tx) => {
      // 增加余额
      await tx
        .update(BillingTable)
        .set({
          // 使用 SQL 表达式增加余额
          balance: sql`${BillingTable.balance} + ${centsToMicroCents(amountInCents)}`,
          // 清除错误信息
          reloadError: null,
          timeReloadError: null,
        })
        .where(eq(BillingTable.workspaceID, Actor.workspace()))

      // 记录支付
      await tx.insert(PaymentTable).values({
        workspaceID: Actor.workspace(),
        id: paymentID,
        // 金额（微美分）
        amount: centsToMicroCents(amountInCents),
        // Stripe 发票 ID
        invoiceID: invoice.id!,
        // Stripe 支付意图 ID
        paymentID: invoice.payments?.data[0].payment.payment_intent as string,
        // Stripe 客户 ID
        customerID,
      })
    })
  }

  /**
   * 授予额度
   *
   * 直接向工作区账户添加额度（用于促销、补偿等）。
   *
   * @param workspaceID - 工作区 ID
   * @param dollarAmount - 额度金额（美元）
   * @returns 添加的额度（微美分）
   *
   * @example
   * ```typescript
   * // 授予 $10 额度
   * await Billing.grantCredit("wrk_123", 10)
   * ```
   */
  export const grantCredit = async (workspaceID: string, dollarAmount: number) => {
    // 转换为微美分
    const amountInMicroCents = centsToMicroCents(dollarAmount * 100)

    await Database.transaction(async (tx) => {
      // 增加余额
      await tx
        .update(BillingTable)
        .set({
          // 使用 SQL 表达式增加余额
          balance: sql`${BillingTable.balance} + ${amountInMicroCents}`,
        })
        .where(eq(BillingTable.workspaceID, workspaceID))

      // 记录支付
      await tx.insert(PaymentTable).values({
        workspaceID,
        id: Identifier.create("payment"),
        amount: amountInMicroCents,
        // 标记为额度类型
        enrichment: {
          type: "credit",
        },
      })
    })

    return amountInMicroCents
  }

  /**
   * 设置月度限额
   *
   * 设置工作区的月度消费限额。
   *
   * @param input - 月度限额（美元）
   * @returns 更新结果
   *
   * @example
   * ```typescript
   * await Billing.setMonthlyLimit(100)
   * // 设置每月最多消费 $100
   * ```
   */
  export const setMonthlyLimit = fn(z.number(), async (input) => {
    return await Database.use((tx) =>
      tx
        .update(BillingTable)
        .set({
          // 设置月度限额（微美分）
          monthlyLimit: input,
        })
        .where(eq(BillingTable.workspaceID, Actor.workspace())),
    )
  })

  /**
   * 生成支付结账 URL
   *
   * 生成 Stripe Checkout 会话 URL，用于首次支付。
   *
   * @param input.successUrl - 支付成功后的跳转 URL
   * @param input.cancelUrl - 取消支付后的跳转 URL
   * @param input.amount - 可选的自定义金额
   * @returns Stripe Checkout 会话 URL
   *
   * @example
   * ```typescript
   * const checkoutUrl = await Billing.generateCheckoutUrl({
   *   successUrl: "https://example.com/success",
   *   cancelUrl: "https://example.com/cancel",
   *   amount: 20,
   * })
   * ```
   */
  export const generateCheckoutUrl = fn(
    z.object({
      // 支付成功后的跳转 URL
      successUrl: z.string(),
      // 取消支付后的跳转 URL
      cancelUrl: z.string(),
      // 可选的自定义金额
      amount: z.number().optional(),
    }),
    async (input) => {
      // 断言是用户级别的 Actor
      const user = Actor.assert("user")
      const { successUrl, cancelUrl, amount } = input

      // 验证最小金额
      if (amount !== undefined && amount < Billing.RELOAD_AMOUNT_MIN) {
        throw new Error(`Amount must be at least $${Billing.RELOAD_AMOUNT_MIN}`)
      }

      // 获取用户邮箱
      const email = await User.getAuthEmail(user.properties.userID)

      // 获取账单配置
      const customer = await Billing.get()

      // 充值金额（美分）
      const amountInCents = (amount ?? customer.reloadAmount ?? Billing.RELOAD_AMOUNT) * 100

      // 创建 Stripe Checkout 会话
      const session = await Billing.stripe().checkout.sessions.create({
        // 支付模式（单次支付）
        mode: "payment",
        // 收集账单地址
        billing_address_collection: "required",
        // 发票项目
        line_items: [
          {
            // 额度项目
            price_data: {
              currency: "usd",
              product_data: { name: ITEM_CREDIT_NAME },
              unit_amount: amountInCents,
            },
            quantity: 1,
          },
          {
            // 手续费项目
            price_data: {
              currency: "usd",
              product_data: { name: ITEM_FEE_NAME },
              unit_amount: calculateFeeInCents(amountInCents),
            },
            quantity: 1,
          },
        ],
        // 客户配置
        ...(customer.customerID
          ? {
              // 已有客户，使用现有客户
              customer: customer.customerID,
              customer_update: {
                name: "auto",
              },
            }
          : {
              // 新客户，创建客户
              customer_email: email!,
              customer_creation: "always",
            }),
        // 货币
        currency: "usd",
        // 启用发票创建
        invoice_creation: {
          enabled: true,
        },
        // 配置支付意图
        payment_intent_data: {
          // 保存支付方式用于未来支付
          setup_future_usage: "on_session",
        },
        // 支付方式类型
        payment_method_types: ["card"],
        // 支付方式数据
        payment_method_data: {
          // 允许重复显示
          allow_redisplay: "always",
        },
        // 启用税务 ID 收集
        tax_id_collection: {
          enabled: true,
        },
        // 元数据
        metadata: {
          // 工作区 ID
          workspaceID: Actor.workspace(),
          // 金额
          amount: amountInCents.toString(),
        },
        // 成功跳转 URL
        success_url: successUrl,
        // 取消跳转 URL
        cancel_url: cancelUrl,
      })

      // 返回 Checkout 会话 URL
      return session.url
    },
  )

  /**
   * 生成 Stripe Portal 会话 URL
   *
   * 生成 Stripe Customer Portal URL，用于管理支付方式和查看发票。
   *
   * @param input.returnUrl - 返回 URL
   * @returns Stripe Portal 会话 URL
   *
   * @example
   * ```typescript
   * const portalUrl = await Billing.generateSessionUrl({
   *   returnUrl: "https://example.com/settings",
   * })
   * ```
   */
  export const generateSessionUrl = fn(
    z.object({
      returnUrl: z.string(),
    }),
    async (input) => {
      const { returnUrl } = input

      // 获取账单配置
      const customer = await Billing.get()

      // 检查是否有 Stripe 客户 ID
      if (!customer?.customerID) {
        throw new Error("No stripe customer ID")
      }

      // 创建 Portal 会话
      const session = await Billing.stripe().billingPortal.sessions.create({
        customer: customer.customerID,
        return_url: returnUrl,
      })

      // 返回 Portal URL
      return session.url
    },
  )

  /**
   * 生成收据 URL
   *
   * 根据 Stripe 支付意图 ID 生成收据 URL。
   *
   * @param input.paymentID - Stripe 支付意图 ID
   * @returns 收据 URL
   *
   * @example
   * ```typescript
   * const receiptUrl = await Billing.generateReceiptUrl({
   *   paymentID: "pi_123...",
   * })
   * ```
   */
  export const generateReceiptUrl = fn(
    z.object({
      paymentID: z.string(),
    }),
    async (input) => {
      const { paymentID } = input

      // 获取支付意图
      const intent = await Billing.stripe().paymentIntents.retrieve(paymentID)

      // 检查是否有相关费用
      if (!intent.latest_charge) throw new Error("No charge found")

      // 获取费用详情
      const charge = await Billing.stripe().charges.retrieve(intent.latest_charge as string)

      // 检查是否有收据 URL
      if (!charge.receipt_url) throw new Error("No receipt URL found")

      // 返回收据 URL
      return charge.receipt_url
    },
  )
}
