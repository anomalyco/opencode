/**
 * ============================================================================
 * 文件名：event.ts
 * 所属包：packages/opencode/src/cli/cmd/tui
 * ============================================================================
 *
 * 文件作用：
 * TUI 事件定义模块。定义 TUI 内部使用的所有事件类型。
 *
 * 主要功能：
 * - TuiEvent namespace：TUI 事件定义
 * - PromptAppend：提示文本追加事件
 * - CommandExecute：命令执行事件
 * - ToastShow：Toast 通知显示事件
 * - SessionSelect：会话选择事件
 *
 * 依赖关系：
 * - @/bus/bus-event：事件定义工具
 * - @/bus：全局事件总线
 * - zod：类型验证
 *
 * 导出内容：
 * - TuiEvent：TUI 事件定义命名空间
 *
 * 事件类型：
 * - PromptAppend：追加文本到提示输入
 * - CommandExecute：执行 TUI 命令
 *   - session.list：列出会话
 *   - session.new：新建会话
 *   - session.share：分享会话
 *   - session.interrupt：中断会话
 *   - session.compact：压缩会话
 *   - session.page.up/down：翻页
 *   - session.half.page.up/down：半页翻页
 *   - session.first/last：跳到首页/末页
 *   - prompt.clear：清除提示
 *   - prompt.submit：提交提示
 *   - agent.cycle：切换 Agent
 * - ToastShow：显示 Toast 通知（info/success/warning/error）
 * - SessionSelect：选择并导航到指定会话
 *
 * @package opencode
 * @module cli/cmd/tui/event
 */

// 导入事件定义工具
import { BusEvent } from "@/bus/bus-event"

// 导入全局事件总线
import { Bus } from "@/bus"

// 导入 Zod 类型验证库
import z from "zod"

/**
 * TUI 事件定义
 *
 * 定义 TUI 内部使用的所有事件类型。
 */
export const TuiEvent = {
  /**
   * 提示文本追加事件
   *
   * 追加文本到提示输入框。
   */
  PromptAppend: BusEvent.define("tui.prompt.append", z.object({ text: z.string() })),

  /**
   * 命令执行事件
   *
   * 执行 TUI 命令。
   */
  CommandExecute: BusEvent.define(
    "tui.command.execute",
    z.object({
      // 命令名称（预定义枚举或自定义字符串）
      command: z.union([
        z.enum([
          "session.list",
          "session.new",
          "session.share",
          "session.interrupt",
          "session.compact",
          "session.page.up",
          "session.page.down",
          "session.half.page.up",
          "session.half.page.down",
          "session.first",
          "session.last",
          "prompt.clear",
          "prompt.submit",
          "agent.cycle",
        ]),
        z.string(),
      ]),
    }),
  ),

  /**
   * Toast 通知显示事件
   *
   * 显示临时通知消息。
   */
  ToastShow: BusEvent.define(
    "tui.toast.show",
    z.object({
      // 标题（可选）
      title: z.string().optional(),
      // 消息内容
      message: z.string(),
      // 通知类型
      variant: z.enum(["info", "success", "warning", "error"]),
      // 显示持续时间（毫秒，默认 5000）
      duration: z.number().default(5000).optional().describe("Duration in milliseconds"),
    }),
  ),

  /**
   * 会话选择事件
   *
   * 选择并导航到指定会话。
   */
  SessionSelect: BusEvent.define(
    "tui.session.select",
    z.object({
      // 要导航到的会话 ID（以 "ses" 开头）
      sessionID: z.string().regex(/^ses/).describe("Session ID to navigate to"),
    }),
  ),
}
