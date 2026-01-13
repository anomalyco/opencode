/**
 * ============================================================================
 * 文件名：footer.tsx
 * 所属包：packages/console/app/src/component
 * ============================================================================
 *
 * 文件作用：
 * 页脚组件。显示网站底部导航链接和 GitHub 星数。
 *
 * 主要功能：
 * - 显示 GitHub 仓库链接和星数
 * - 显示文档、Discord、X(Twitter) 链接
 * - 异步获取实时 GitHub 数据
 *
 * 依赖关系：
 * - @solidjs/router：路由和异步数据
 * - solid-js：SolidJS 核心库
 * - ~/lib/github：GitHub API 调用
 * - ~/config：应用配置
 *
 * 导出内容：
 * - Footer：页脚组件
 *
 * @package console.app
 * @module footer
 */

// 导入异步数据创建工具
import { createAsync } from "@solidjs/router"

// 导入派生信号创建工具
import { createMemo } from "solid-js"

// 导入 GitHub API 函数
import { github } from "~/lib/github"

// 导入应用配置
import { config } from "~/config"

/**
 * 页脚组件
 *
 * 显示网站底部导航链接和 GitHub 星数。
 *
 * @returns SolidJS 组件
 */
export function Footer() {
  // 异步获取 GitHub 数据
  const githubData = createAsync(() => github())
  // 计算格式化的星数（使用紧凑格式，如 "60K"）
  const starCount = createMemo(() =>
    githubData()?.stars
      ? new Intl.NumberFormat("en-US", {
          notation: "compact",
          compactDisplay: "short",
        }).format(githubData()!.stars!)
      : config.github.starsFormatted.compact,
  )

  return (
    <footer data-component="footer">
      {/* GitHub 链接 */}
      <div data-slot="cell">
        <a href={config.github.repoUrl} target="_blank">
          GitHub <span>[{starCount()}]</span>
        </a>
      </div>
      {/* 文档链接 */}
      <div data-slot="cell">
        <a href="/docs">Docs</a>
      </div>
      {/* Discord 链接 */}
      <div data-slot="cell">
        <a href="/discord">Discord</a>
      </div>
      {/* X(Twitter) 链接 */}
      <div data-slot="cell">
        <a href={config.social.twitter}>X</a>
      </div>
    </footer>
  )
}
