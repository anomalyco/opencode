/**
 * ============================================================================
 * 文件名：config.ts
 * 所属包：packages/console/app/src
 * ============================================================================
 *
 * 文件作用：
 * 应用全局配置常量。定义网站的基础 URL、社交媒体链接、GitHub 统计等。
 *
 * 主要功能：
 * - 定义基础 URL
 * - 存储 GitHub 仓库信息
 * - 配置社交媒体链接
 * - 存储静态统计数据（用于首页展示）
 *
 * 依赖关系：
 * - 无外部依赖
 *
 * 导出内容：
 * - config：应用配置对象（只读）
 *
 * 配置项说明：
 * - baseUrl：网站基础 URL
 * - github.repoUrl：GitHub 仓库地址
 * - github.starsFormatted：GitHub 星数格式化显示
 * - social：社交媒体链接（Twitter/X、Discord）
 * - stats：静态统计数据（贡献者数、提交数、月活用户）
 *
 * @package console.app
 * @module config
 */

/**
 * 应用全局常量和配置
 *
 * 包含网站运行所需的各种配置参数。
 * 使用 `as const` 确保类型推断为最具体的字面量类型。
 */
export const config = {
  // 基础 URL
  baseUrl: "https://opencode.ai",

  // GitHub 配置
  github: {
    // GitHub 仓库地址
    repoUrl: "https://github.com/anomalyco/opencode",
    // GitHub 星数格式化显示
    starsFormatted: {
      // 紧凑格式（短形式）
      compact: "60K",
      // 完整格式（带千位分隔符）
      full: "60,000",
    },
  },

  // 社交媒体链接
  social: {
    // Twitter/X 链接
    twitter: "https://x.com/opencode",
    // Discord 邀请链接
    discord: "https://discord.gg/opencode",
  },

  // 静态统计数据（用于首页展示）
  stats: {
    // 贡献者数量
    contributors: "500",
    // Git 提交数量
    commits: "6,500",
    // 月活跃用户数
    monthlyUsers: "650,000",
  },
} as const
