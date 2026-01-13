/**
 * ============================================================================
 * 文件名：aws.ts
 * 所属包：packages/console/core/src
 * ============================================================================
 *
 * 文件作用：
 * AWS SES 邮件发送服务模块。封装 AWS Simple Email Service (SES) API，
 * 提供统一的邮件发送功能。
 *
 * 主要功能：
 * - 创建和复用 AWS 客户端
 * - 发送文本和 HTML 邮件
 * - 支持可选的回复地址
 *
 * 依赖关系：
 * - zod：运行时类型验证
 * - aws4fetch：AWS Signature V4 签名 Fetch 客户端
 * - @opencode-ai/console-resource：AWS 凭证资源
 * - ./util/fn：函数包装工具
 *
 * 导出内容：
 * - AWS.sendEmail：发送邮件
 *
 * 使用场景：
 * - 发送邀请邮件
 * - 发送通知邮件
 * - 发送验证邮件
 *
 * AWS SES 配置：
 * - 区域：us-east-1
 * - 发件人：OpenCode Zen <contact@anoma.ly>
 *
 * @package console.core
 * @module aws
 */

// 导入 Zod 类型验证库
import { z } from "zod"

// 导入资源管理模块（包含 AWS 凭证）
import { Resource } from "@opencode-ai/console-resource"

// 导入 AWS Signature V4 签名 Fetch 客户端
import { AwsClient } from "aws4fetch"

// 导入函数包装工具
import { fn } from "./util/fn"

/**
 * AWS 命名空间
 *
 * 包含所有 AWS 服务相关的操作函数。
 */
export namespace AWS {
  // AWS 客户端实例（单例模式）
  let client: AwsClient

  /**
   * 创建 AWS 客户端
   *
   * 使用单例模式，确保只创建一个客户端实例。
   * 从资源中获取 AWS SES 凭证。
   *
   * @returns AWS 客户端实例
   */
  const createClient = () => {
    // 如果客户端已存在，直接返回
    if (!client) {
      // 创建新的 AWS 客户端
      client = new AwsClient({
        // AWS 访问密钥 ID（从资源获取）
        accessKeyId: Resource.AWS_SES_ACCESS_KEY_ID.value,
        // AWS 秘密访问密钥（从资源获取）
        secretAccessKey: Resource.AWS_SES_SECRET_ACCESS_KEY.value,
        // AWS 区域（SES 使用 us-east-1）
        region: "us-east-1",
      })
    }
    // 返回客户端实例
    return client
  }

  /**
   * 发送邮件
   *
   * 使用 AWS SES 发送邮件。
   * 支持纯文本和 HTML 格式，两者内容相同。
   *
   * @param input.to - 收件人邮箱地址
   * @param input.subject - 邮件主题
   * @param input.body - 邮件正文（同时用于文本和 HTML）
   * @param input.replyTo - 可选的回复地址
   * @returns 发送结果
   *
   * @example
   * ```typescript
   * await AWS.sendEmail({
   *   to: "user@example.com",
   *   subject: "Welcome to OpenCode",
   *   body: "<h1>Hello!</h1><p>Welcome to our platform.</p>",
   *   replyTo: "support@anoma.ly",
   * })
   * ```
   */
  export const sendEmail = fn(
    z.object({
      // 收件人邮箱地址
      to: z.string(),
      // 邮件主题
      subject: z.string(),
      // 邮件正文
      body: z.string(),
      // 可选的回复地址
      replyTo: z.string().optional(),
    }),
    async (input) => {
      // 调用 AWS SES API 发送邮件
      const res = await createClient().fetch("https://email.us-east-1.amazonaws.com/v2/email/outbound-emails", {
        // 使用 POST 方法
        method: "POST",
        // 设置请求头
        headers: {
          // AWS SES 目标 API（SendEmail 操作）
          "X-Amz-Target": "SES.SendEmail",
          // 请求体为 JSON 格式
          "Content-Type": "application/json",
        },
        // 请求体包含邮件详情
        body: JSON.stringify({
          // 发件人地址（固定为 OpenCode Zen）
          FromEmailAddress: `OpenCode Zen <contact@anoma.ly>`,
          // 收件人地址列表
          Destination: {
            ToAddresses: [input.to],
          },
          // 可选的回复地址
          ...(input.replyTo && { ReplyToAddresses: [input.replyTo] }),
          // 邮件内容
          Content: {
            // 简单邮件类型（非模板）
            Simple: {
              // 邮件主题
              Subject: {
                // 字符编码为 UTF-8
                Charset: "UTF-8",
                // 主题内容
                Data: input.subject,
              },
              // 邮件正文
              Body: {
                // 纯文本版本
                Text: {
                  Charset: "UTF-8",
                  Data: input.body,
                },
                // HTML 版本
                Html: {
                  Charset: "UTF-8",
                  Data: input.body,
                },
              },
            },
          },
        }),
      })
      // 检查发送结果
      if (!res.ok) {
        // 发送失败，抛出错误
        throw new Error(`Failed to send email: ${res.statusText}`)
      }
    },
  )
}
