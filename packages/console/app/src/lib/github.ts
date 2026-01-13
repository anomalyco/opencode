/**
 * ============================================================================
 * 文件名：github.ts
 * 所属包：packages/console/app/src/lib
 * ============================================================================
 *
 * 文件作用：
 * GitHub API 调用模块。获取 GitHub 仓库的元数据。
 *
 * 主要功能：
 * - 获取仓库星数
 * - 获取最新发布信息
 * - 获取贡献者数量
 *
 * 依赖关系：
 * - @solidjs/router：查询函数
 * - ~/config：应用配置（包含 GitHub 仓库 URL）
 *
 * 导出内容：
 * - github：GitHub 数据查询函数
 *
 * 返回数据格式：
 * ```typescript
 * {
 *   stars: number,           // GitHub 星数
 *   release: {
 *     name: string,          // 发布名称
 *     url: string,           // 发布 URL
 *     tag_name: string,      // 标签名
 *   },
 *   contributors: number,    // 贡献者数量
 * }
 * ```
 *
 * @package console.app
 * @module github
 */

// 导入查询函数
import { query } from "@solidjs/router"

// 导入应用配置
import { config } from "~/config"

/**
 * GitHub 数据查询
 *
 * 从 GitHub API 获取仓库的元数据，包括星数、最新发布和贡献者数量。
 *
 * @returns GitHub 仓库数据，失败时返回 undefined
 */
export const github = query(async () => {
  // 标记为服务端函数
  "use server"
  // 设置请求头（模拟浏览器，避免被限流）
  const headers = {
    "User-Agent":
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/108.0.0.0 Safari/537.36",
  }
  // 将 GitHub URL 转换为 API URL
  const apiBaseUrl = config.github.repoUrl.replace("https://github.com/", "https://api.github.com/repos/")
  try {
    // 并行请求仓库元数据、发布列表、贡献者列表
    const [meta, releases, contributors] = await Promise.all([
      // 仓库元数据
      fetch(apiBaseUrl, { headers }).then((res) => res.json()),
      // 发布列表
      fetch(`${apiBaseUrl}/releases`, { headers }).then((res) => res.json()),
      // 贡献者列表（仅获取 1 条，用于获取总数）
      fetch(`${apiBaseUrl}/contributors?per_page=1`, { headers }),
    ])
    // 获取最新发布
    const [release] = releases
    // 从 Link 头解析贡献者总数（获取最后一页的页码）
    const contributorCount = Number.parseInt(
      contributors.headers
        .get("Link")!
        .match(/&page=(\d+)>; rel="last"/)!
        .at(1)!,
    )
    // 返回 GitHub 数据
    return {
      // 星数
      stars: meta.stargazers_count,
      // 最新发布
      release: {
        name: release.name,
        url: release.html_url,
        tag_name: release.tag_name,
      },
      // 贡献者数量
      contributors: contributorCount,
    }
  } catch (e) {
    // 错误处理
    console.error(e)
  }
  // 失败时返回 undefined
  return undefined
}, "github")
