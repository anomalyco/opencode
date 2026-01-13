/**
 * ============================================================================
 * 文件名：email-signup.tsx
 * 所属包：packages/console/app/src/component
 * ============================================================================
 *
 * 文件作用：
 * 邮件订阅组件。提供用户邮件订阅功能，使用 EmailOctopus 服务。
 *
 * 主要功能：
 * - 邮件地址输入
 * - 提交订阅到 EmailOctopus
 * - 显示订阅状态（成功/失败）
 * - 加载状态禁用提交按钮
 *
 * 依赖关系：
 * - @solidjs/router：路由和服务器操作
 * - @opencode-ai/console-resource：EmailOctopus API 密钥
 * - solid-js：SolidJS 核心库
 *
 * 导出内容：
 * - EmailSignup：邮件订阅组件
 *
 * @package console.app
 * @module email-signup
 */

// 导入服务器操作和提交状态
import { action, useSubmission } from "@solidjs/router"

// 导入图片资源
import dock from "../asset/lander/dock.png"

// 导入资源配置
import { Resource } from "@opencode-ai/console-resource"

// 导入条件渲染组件
import { Show } from "solid-js"

/**
 * 邮件订阅服务器操作
 *
 * 处理用户邮件订阅请求，将邮件地址添加到 EmailOctopus 邮件列表。
 */
const emailSignup = action(async (formData: FormData) => {
  // 标记为服务端函数
  "use server"
  // 从表单获取邮件地址
  const emailAddress = formData.get("email")!
  // EmailOctopus 邮件列表 ID
  const listId = "8b9bb82c-9d5f-11f0-975f-0df6fd1e4945"
  // 调用 EmailOctopus API 添加联系人
  const response = await fetch(`https://api.emailoctopus.com/lists/${listId}/contacts`, {
    method: "PUT",
    headers: {
      // Bearer Token 认证
      Authorization: `Bearer ${Resource.EMAILOCTOPUS_API_KEY.value}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      email_address: emailAddress,
    }),
  })
  // 记录响应（调试用）
  console.log(response)
  // 返回成功
  return true
})

/**
 * 邮件订阅组件
 *
 * 提供邮件订阅表单，收集用户邮件并添加到邮件列表。
 *
 * @returns SolidJS 组件
 */
export function EmailSignup() {
  // 获取提交状态
  const submission = useSubmission(emailSignup)
  return (
    <section data-component="email">
      {/* 标题区域 */}
      <div data-slot="section-title">
        <h3>Be the first to know when we release new products</h3>
        <p>Join the waitlist for early access.</p>
      </div>
      {/* 订阅表单 */}
      <form data-slot="form" action={emailSignup} method="post">
        {/* 邮件输入框 */}
        <input type="email" name="email" placeholder="Email address" required />
        {/* 提交按钮（提交时禁用） */}
        <button type="submit" disabled={submission.pending}>
          Subscribe
        </button>
      </form>
      {/* 成功消息 */}
      <Show when={submission.result}>
        <div style="color: #03B000; margin-top: 24px;">
          Almost done, check your inbox and confirm your email address
        </div>
      </Show>
      {/* 错误消息 */}
      <Show when={submission.error}>
        <div style="color: #FF408F; margin-top: 24px;">{submission.error}</div>
      </Show>
    </section>
  )
}
