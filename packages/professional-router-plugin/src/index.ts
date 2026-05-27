/**
 * Professional Router Plugin for OpenCode
 *
 * 专业业务智能路由插件
 * - 自动识别法律、专利、商标、版权等专业业务
 * - 根据复杂度选择合适的工作流程
 * - 集成 HITL（Human-In-The-Loop）机制
 * - 连接到专业技能触发
 */

import type { Plugin, PluginInput, PluginOptions } from "@yunpat/plugin"
import type { RouterContext } from "./types/index.js"
import { RoutingDecisionStore } from "./types/index.js"
import { createMessageHandler } from "./hooks/message-handler.js"
import { createToolBeforeHandler } from "./hooks/tool-before.js"
import { createToolAfterHandler } from "./hooks/tool-after.js"
import { createSystemPromptHandler } from "./hooks/system-prompt.js"
import { ProfessionalRouterService } from "./core/router-service.js"

/**
 * Professional Router Plugin 入口
 */
const ProfessionalRouterPlugin: Plugin = async (input: PluginInput, options?: PluginOptions) => {
  console.log("[ProfessionalRouter] Plugin 初始化")

  // 初始化路由服务
  const routerService = new ProfessionalRouterService(options)

  // 创建路由决策存储（内存中按 session 隔离，所有钩子共享）
  const decisionStore = new RoutingDecisionStore()

  // 创建上下文（仅包含生命周期级别的字段）
  const context: RouterContext = {
    client: input.client,
    routerService,
    decisionStore,
    options: options ?? {},
  }

  return {
    // 消息处理钩子 - 拦截用户消息并进行路由决策
    "chat.message": createMessageHandler(context),

    // 工具执行前钩子 - 可以根据路由决策修改工具参数
    "tool.execute.before": createToolBeforeHandler(context),

    // 工具执行后钩子 - 记录执行结果和状态
    "tool.execute.after": createToolAfterHandler(context),

    // 系统提示词转换钩子 - 注入专业领域提示词
    "experimental.chat.system.transform": createSystemPromptHandler(context),
  }
}

export default ProfessionalRouterPlugin
