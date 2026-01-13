/**
 * ============================================================================
 * 文件名：flag.ts
 * 所属包：packages/opencode/src/flag
 * ============================================================================
 *
 * 文件作用：
 * 命令行标志（环境变量）配置模块。定义所有 OpenCode 的环境变量标志。
 *
 * 主要功能：
 * - 定义所有环境变量常量
 * - 提供 truthy 值解析
 * - 提供数值解析
 * - 支持功能开关控制
 * - 实验性功能管理
 *
 * 依赖关系：
 * - 无外部依赖（仅使用 process.env）
 *
 * 导出内容：
 * - Flag namespace：环境变量标志命名空间
 *   - 包含所有 OPENCODE_* 环境变量的常量定义
 *
 * 标志类型：
 * - 布尔标志：truthy() 解析，"true" 或 "1" 为 true
 * - 字符串标志：直接读取值
 * - 数值标志：number() 解析，必须是正整数
 *
 * 主要标志分类：
 * 1. 功能开关
 * 2. 配置路径
 * 3. 实验性功能
 * 4. 调试选项
 *
 * @package opencode
 * @module flag
 */

/**
 * 标志命名空间
 *
 * 包含所有 OpenCode 环境变量的定义和解析逻辑。
 */
export namespace Flag {
  // =========================================================================
  // 功能开关
  // =========================================================================

  /**
   * 自动分享会话
   * - 环境变量：OPENCODE_AUTO_SHARE
   * - 类型：boolean
   * - 默认值：false
   */
  export const OPENCODE_AUTO_SHARE = truthy("OPENCODE_AUTO_SHARE")

  /**
   * 禁用自动更新
   * - 环境变量：OPENCODE_DISABLE_AUTOUPDATE
   * - 类型：boolean
   * - 默认值：false
   */
  export const OPENCODE_DISABLE_AUTOUPDATE = truthy("OPENCODE_DISABLE_AUTOUPDATE")

  /**
   * 禁用会话修剪（pruning）
   * - 环境变量：OPENCODE_DISABLE_PRUNE
   * - 类型：boolean
   * - 默认值：false
   */
  export const OPENCODE_DISABLE_PRUNE = truthy("OPENCODE_DISABLE_PRUNE")

  /**
   * 禁用终端标题更新
   * - 环境变量：OPENCODE_DISABLE_TERMINAL_TITLE
   * - 类型：boolean
   * - 默认值：false
   */
  export const OPENCODE_DISABLE_TERMINAL_TITLE = truthy("OPENCODE_DISABLE_TERMINAL_TITLE")

  /**
   * 禁用默认插件
   * - 环境变量：OPENCODE_DISABLE_DEFAULT_PLUGINS
   * - 类型：boolean
   * - 默认值：false
   */
  export const OPENCODE_DISABLE_DEFAULT_PLUGINS = truthy("OPENCODE_DISABLE_DEFAULT_PLUGINS")

  /**
   * 禁用 LSP 下载
   * - 环境变量：OPENCODE_DISABLE_LSP_DOWNLOAD
   * - 类型：boolean
   * - 默认值：false
   */
  export const OPENCODE_DISABLE_LSP_DOWNLOAD = truthy("OPENCODE_DISABLE_LSP_DOWNLOAD")

  /**
   * 启用实验性模型
   * - 环境变量：OPENCODE_ENABLE_EXPERIMENTAL_MODELS
   * - 类型：boolean
   * - 默认值：false
   */
  export const OPENCODE_ENABLE_EXPERIMENTAL_MODELS = truthy("OPENCODE_ENABLE_EXPERIMENTAL_MODELS")

  /**
   * 禁用自动压缩
   * - 环境变量：OPENCODE_DISABLE_AUTOCOMPACT
   * - 类型：boolean
   * - 默认值：false
   */
  export const OPENCODE_DISABLE_AUTOCOMPACT = truthy("OPENCODE_DISABLE_AUTOCOMPACT")

  /**
   * 禁用模型获取
   * - 环境变量：OPENCODE_DISABLE_MODELS_FETCH
   * - 类型：boolean
   * - 默认值：false
   */
  export const OPENCODE_DISABLE_MODELS_FETCH = truthy("OPENCODE_DISABLE_MODELS_FETCH")

  /**
   * 禁用 Claude Code 功能
   * - 环境变量：OPENCODE_DISABLE_CLAUDE_CODE
   * - 类型：boolean
   * - 默认值：false
   */
  export const OPENCODE_DISABLE_CLAUDE_CODE = truthy("OPENCODE_DISABLE_CLAUDE_CODE")

  /**
   * 禁用 Claude Code 提示
   * - 环境变量：OPENCODE_DISABLE_CLAUDE_CODE_PROMPT
   * - 类型：boolean
   * - 默认值：继承 OPENCODE_DISABLE_CLAUDE_CODE
   */
  export const OPENCODE_DISABLE_CLAUDE_CODE_PROMPT =
    OPENCODE_DISABLE_CLAUDE_CODE || truthy("OPENCODE_DISABLE_CLAUDE_CODE_PROMPT")

  /**
   * 禁用 Claude Code 技能
   * - 环境变量：OPENCODE_DISABLE_CLAUDE_CODE_SKILLS
   * - 类型：boolean
   * - 默认值：继承 OPENCODE_DISABLE_CLAUDE_CODE
   */
  export const OPENCODE_DISABLE_CLAUDE_CODE_SKILLS =
    OPENCODE_DISABLE_CLAUDE_CODE || truthy("OPENCODE_DISABLE_CLAUDE_CODE_SKILLS")

  // =========================================================================
  // 配置路径
  // =========================================================================

  /**
   * Git Bash 路径
   * - 环境变量：OPENCODE_GIT_BASH_PATH
   * - 类型：string | undefined
   * - 用途：指定 Git Bash 可执行文件路径
   */
  export const OPENCODE_GIT_BASH_PATH = process.env["OPENCODE_GIT_BASH_PATH"]

  /**
   * 配置文件路径
   * - 环境变量：OPENCODE_CONFIG
   * - 类型：string | undefined
   * - 用途：指定配置文件路径
   */
  export const OPENCODE_CONFIG = process.env["OPENCODE_CONFIG"]

  /**
   * 配置目录路径
   * - 环境变量：OPENCODE_CONFIG_DIR
   * - 类型：string | undefined
   * - 用途：指定配置目录路径
   */
  export const OPENCODE_CONFIG_DIR = process.env["OPENCODE_CONFIG_DIR"]

  /**
   * 配置内容
   * - 环境变量：OPENCODE_CONFIG_CONTENT
   * - 类型：string | undefined
   * - 用途：直接提供配置内容（不使用文件）
   */
  export const OPENCODE_CONFIG_CONTENT = process.env["OPENCODE_CONFIG_CONTENT"]

  // =========================================================================
  // 权限和认证
  // =========================================================================

  /**
   * 权限级别
   * - 环境变量：OPENCODE_PERMISSION
   * - 类型：string | undefined
   * - 用途：设置默认权限级别
   */
  export const OPENCODE_PERMISSION = process.env["OPENCODE_PERMISSION"]

  /**
   * 客户端标识
   * - 环境变量：OPENCODE_CLIENT
   * - 类型：string
   * - 默认值："cli"
   * - 用途：标识调用 OpenCode 的客户端
   */
  export const OPENCODE_CLIENT = process.env["OPENCODE_CLIENT"] ?? "cli"

  /**
   * 服务器密码
   * - 环境变量：OPENCODE_SERVER_PASSWORD
   * - 类型：string | undefined
   * - 用途：服务器模式认证密码
   */
  export const OPENCODE_SERVER_PASSWORD = process.env["OPENCODE_SERVER_PASSWORD"]

  /**
   * 服务器用户名
   * - 环境变量：OPENCODE_SERVER_USERNAME
   * - 类型：string | undefined
   * - 用途：服务器模式认证用户名
   */
  export const OPENCODE_SERVER_USERNAME = process.env["OPENCODE_SERVER_USERNAME"]

  // =========================================================================
  // 测试和调试
  // =========================================================================

  /**
   * 模拟 VCS（版本控制系统）
   * - 环境变量：OPENCODE_FAKE_VCS
   * - 类型：string | undefined
   * - 用途：测试时模拟版本控制
   */
  export const OPENCODE_FAKE_VCS = process.env["OPENCODE_FAKE_VCS"]

  // =========================================================================
  // 实验性功能
  // =========================================================================

  /**
   * 启用所有实验性功能
   * - 环境变量：OPENCODE_EXPERIMENTAL
   * - 类型：boolean
   * - 默认值：false
   */
  export const OPENCODE_EXPERIMENTAL = truthy("OPENCODE_EXPERIMENTAL")

  /**
   * 实验性文件监控
   * - 环境变量：OPENCODE_EXPERIMENTAL_FILEWATCHER
   * - 类型：boolean
   * - 默认值：false
   */
  export const OPENCODE_EXPERIMENTAL_FILEWATCHER = truthy("OPENCODE_EXPERIMENTAL_FILEWATCHER")

  /**
   * 禁用实验性文件监控
   * - 环境变量：OPENCODE_EXPERIMENTAL_DISABLE_FILEWATCHER
   * - 类型：boolean
   * - 默认值：false
   */
  export const OPENCODE_EXPERIMENTAL_DISABLE_FILEWATCHER = truthy("OPENCODE_EXPERIMENTAL_DISABLE_FILEWATCHER")

  /**
   * 实验性图标发现
   * - 环境变量：OPENCODE_EXPERIMENTAL_ICON_DISCOVERY
   * - 类型：boolean
   * - 默认值：false（除非 OPENCODE_EXPERIMENTAL=true）
   */
  export const OPENCODE_EXPERIMENTAL_ICON_DISCOVERY =
    OPENCODE_EXPERIMENTAL || truthy("OPENCODE_EXPERIMENTAL_ICON_DISCOVERY")

  /**
   * 禁用选择时复制
   * - 环境变量：OPENCODE_EXPERIMENTAL_DISABLE_COPY_ON_SELECT
   * - 类型：boolean
   * - 默认值：false
   */
  export const OPENCODE_EXPERIMENTAL_DISABLE_COPY_ON_SELECT = truthy("OPENCODE_EXPERIMENTAL_DISABLE_COPY_ON_SELECT")

  /**
   * 启用 Exa 搜索
   * - 环境变量：OPENCODE_ENABLE_EXA
   * - 类型：boolean
   * - 默认值：false（除非 OPENCODE_EXPERIMENTAL=true）
   */
  export const OPENCODE_ENABLE_EXA =
    truthy("OPENCODE_ENABLE_EXA") || OPENCODE_EXPERIMENTAL || truthy("OPENCODE_EXPERIMENTAL_EXA")

  /**
   * Bash 最大输出长度
   * - 环境变量：OPENCODE_EXPERIMENTAL_BASH_MAX_OUTPUT_LENGTH
   * - 类型：number | undefined
   * - 用途：限制 Bash 命令的输出长度
   */
  export const OPENCODE_EXPERIMENTAL_BASH_MAX_OUTPUT_LENGTH = number("OPENCODE_EXPERIMENTAL_BASH_MAX_OUTPUT_LENGTH")

  /**
   * Bash 默认超时时间（毫秒）
   * - 环境变量：OPENCODE_EXPERIMENTAL_BASH_DEFAULT_TIMEOUT_MS
   * - 类型：number | undefined
   * - 用途：设置 Bash 命令的默认超时
   */
  export const OPENCODE_EXPERIMENTAL_BASH_DEFAULT_TIMEOUT_MS = number("OPENCODE_EXPERIMENTAL_BASH_DEFAULT_TIMEOUT_MS")

  /**
   * 输出 token 最大值
   * - 环境变量：OPENCODE_EXPERIMENTAL_OUTPUT_TOKEN_MAX
   * - 类型：number | undefined
   * - 用途：限制输出的 token 数量
   */
  export const OPENCODE_EXPERIMENTAL_OUTPUT_TOKEN_MAX = number("OPENCODE_EXPERIMENTAL_OUTPUT_TOKEN_MAX")

  /**
   * 实验性输出格式化
   * - 环境变量：OPENCODE_EXPERIMENTAL_OXFMT
   * - 类型：boolean
   * - 默认值：false（除非 OPENCODE_EXPERIMENTAL=true）
   */
  export const OPENCODE_EXPERIMENTAL_OXFMT = OPENCODE_EXPERIMENTAL || truthy("OPENCODE_EXPERIMENTAL_OXFMT")

  /**
   * 实验性 LSP TypeScript 集成
   * - 环境变量：OPENCODE_EXPERIMENTAL_LSP_TY
   * - 类型：boolean
   * - 默认值：false
   */
  export const OPENCODE_EXPERIMENTAL_LSP_TY = truthy("OPENCODE_EXPERIMENTAL_LSP_TY")

  /**
   * 实验性 LSP 工具
   * - 环境变量：OPENCODE_EXPERIMENTAL_LSP_TOOL
   * - 类型：boolean
   * - 默认值：false（除非 OPENCODE_EXPERIMENTAL=true）
   */
  export const OPENCODE_EXPERIMENTAL_LSP_TOOL = OPENCODE_EXPERIMENTAL || truthy("OPENCODE_EXPERIMENTAL_LSP_TOOL")

  // =========================================================================
  // 辅助函数
  // =========================================================================

  /**
   * 解析布尔值
   *
   * 将环境变量值解析为布尔值。
   * 只有 "true" 或 "1"（不区分大小写）返回 true。
   *
   * @param key - 环境变量键名
   * @returns 是否为 true
   *
   * 有效值：true, TRUE, True, 1
   * 其他值都返回 false
   */
  function truthy(key: string) {
    // 获取环境变量值并转换为小写
    const value = process.env[key]?.toLowerCase()
    // 检查是否为 "true" 或 "1"
    return value === "true" || value === "1"
  }

  /**
   * 解析数值
   *
   * 将环境变量值解析为正整数。
   * 只有有效的正整数才返回解析后的值。
   *
   * @param key - 环境变量键名
   * @returns 解析后的正整数，或 undefined
   *
   * 有效值：必须是可以解析为正整数的字符串
   * - "100" → 100
   * - "0" → undefined（不是正数）
   * - "-1" → undefined（不是正数）
   * - "abc" → undefined（不是数字）
   * - undefined → undefined
   */
  function number(key: string) {
    // 获取环境变量值
    const value = process.env[key]

    // 如果值为空，返回 undefined
    if (!value) return undefined

    // 尝试解析为数字
    const parsed = Number(value)

    // 只有正整数才有效
    return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined
  }
}
