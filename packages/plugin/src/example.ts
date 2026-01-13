/**
 * ============================================================================
 * 文件名：example.ts
 * 所属包：packages/plugin/src
 * ============================================================================
 *
 * 文件作用：
 * 提供一个完整的插件示例，演示如何创建 OpenCode 插件。
 *
 * 主要功能：
 * - 演示插件的基本结构
 * - 演示如何定义自定义工具
 * - 演示如何使用 Zod 定义工具参数
 * - 演示工具的执行逻辑
 *
 * 依赖关系：
 * - ./index：插件系统核心类型
 * - ./tool：工具定义工厂函数
 *
 * 导出内容：
 * - ExamplePlugin：示例插件，可作为模板参考
 *
 * 使用场景：
 * - 作为插件开发的参考示例
 * - 理解插件系统的用法
 * - 快速开始创建新插件
 *
 * @package plugin
 * @module example
 */

// 导入插件核心类型定义
// Plugin 类型定义了插件的签名和输入参数
import { Plugin } from "./index"

// 导入工具工厂函数
// 用于创建可被 AI Agent 调用的工具
import { tool } from "./tool"

/**
 * 示例插件
 *
 * 这是一个最小化的插件示例，演示了插件的基本结构。
 * 插件注册了一个名为 "mytool" 的自定义工具。
 *
 * 插件工作流程：
 * 1. OpenCode 加载插件并调用此函数
 * 2. 传入插件上下文（ctx），包含 client、project、$ 等
 * 3. 插件返回钩子配置对象，定义插件提供哪些功能
 * 4. 当 AI 需要使用工具时，会调用注册的工具
 *
 * @param ctx - 插件输入上下文，包含：
 *   - client: OpenCode 客户端实例
 *   - project: 项目信息
 *   - directory: 项目目录路径
 *   - worktree: Git worktree 路径
 *   - serverUrl: 服务器 URL
 *   - $: Shell 命令执行接口
 * @returns 钩子配置对象
 */
export const ExamplePlugin: Plugin = async (ctx) => {
  // 返回钩子配置
  // 这里定义了一个 tool 钩子，注册自定义工具
  return {
    // 工具钩子
    // 键是工具名称（mytool），值是工具定义
    tool: {
      // 定义名为 "mytool" 的自定义工具
      // AI Agent 可以通过这个名称调用此工具
      mytool: tool({
        // 工具描述
        // AI 会根据这个描述理解工具的作用
        // 当用户请求相关功能时，AI 会选择使用此工具
        description: "This is a custom tool",

        // 工具参数定义
        // 使用 Zod schema 定义参数的类型和验证规则
        args: {
          // 定义名为 "foo" 的字符串参数
          // describe() 方法为参数添加说明，帮助 AI 理解参数用途
          foo: tool.schema.string().describe("foo"),
        },

        // 工具执行函数
        // 当 AI Agent 调用此工具时，此函数会被执行
        // args 是验证后的参数对象
        // context 包含会话信息（sessionID、messageID、agent、abort）
        async execute(args) {
          // 返回执行结果
          // 结果会发送给 AI，AI 可以根据结果继续操作
          return `Hello ${args.foo}!`
        },
      }),
    },
  }
}
