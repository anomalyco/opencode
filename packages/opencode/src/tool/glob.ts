/**
 * ============================================================================
 * 文件名：glob.ts
 * 所属包：packages/opencode/src/tool
 * ============================================================================
 *
 * 文件作用：
 * Glob 工具模块。允许 AI 使用 glob 模式搜索文件。
 *
 * 主要功能：
 * - GlobTool：使用 glob 模式搜索文件的工具
 * - 支持自定义搜索目录
 * - 结果按修改时间排序
 * - 限制结果数量（最多 100 个）
 * - 检测结果截断
 *
 * 依赖关系：
 * - zod：类型验证
 * - path：路径处理
 * - ./tool：工具基类
 * - ./glob.txt：工具描述模板
 * - ../file/ripgrep：Ripgrep 文件搜索
 * - ../project/instance：实例管理
 * - ./external-directory：外部目录检查
 *
 * 导出内容：
 * - GlobTool：Glob 工具定义
 *
 * 参数：
 * - pattern：glob 模式（如 *.ts, **/*.tsx）
 * - path：搜索目录（可选，默认当前工作目录）
 *
 * 返回：
 * - title：相对路径标题
 * - output：文件路径列表（每行一个）
 * - metadata：元数据（count、truncated）
 *
 * 常量：
 * - limit：最大结果数（100）
 *
 * 行为：
 * - 结果按修改时间倒序排列（最新的在前）
 * - 超过限制时截断并提示
 * - 没有结果时返回 "No files found"
 *
 * @package opencode
 * @module tool/glob
 */

// 导入 Zod 类型验证库
import z from "zod"

// 导入路径处理
import path from "path"

// 导入工具基类
import { Tool } from "./tool"

// 导入工具描述模板
import DESCRIPTION from "./glob.txt"

// 导入 Ripgrep 文件搜索
import { Ripgrep } from "../file/ripgrep"

// 导入实例管理
import { Instance } from "../project/instance"

// 导入外部目录检查
import { assertExternalDirectory } from "./external-directory"

/**
 * Glob 工具定义
 *
 * 允许 AI 使用 glob 模式搜索文件。
 */
export const GlobTool = Tool.define("glob", {
  // 工具描述（从模板导入）
  description: DESCRIPTION,

  // 参数 Schema
  parameters: z.object({
    // glob 模式
    pattern: z.string().describe("The glob pattern to match files against"),
    // 搜索目录（可选）
    path: z
      .string()
      .optional()
      .describe(
        `The directory to search in. If not specified, the current working directory will be used. IMPORTANT: Omit this field to use the default directory. DO NOT enter "undefined" or "null" - simply omit it for the default behavior. Must be a valid directory path if provided.`,
      ),
  }),

  async execute(params, ctx) {
    // 请求 glob 权限
    await ctx.ask({
      permission: "glob",
      patterns: [params.pattern],
      always: ["*"],
      metadata: {
        pattern: params.pattern,
        path: params.path,
      },
    })

    // 解析搜索目录
    let search = params.path ?? Instance.directory
    search = path.isAbsolute(search) ? search : path.resolve(Instance.directory, search)

    // 检查外部目录权限
    await assertExternalDirectory(ctx, search, { kind: "directory" })

    // 结果限制
    const limit = 100
    const files = []
    let truncated = false

    // 使用 Ripgrep 搜索文件
    for await (const file of Ripgrep.files({
      cwd: search,
      glob: [params.pattern],
    })) {
      // 检查是否超过限制
      if (files.length >= limit) {
        truncated = true
        break
      }

      // 解析完整路径
      const full = path.resolve(search, file)

      // 获取文件修改时间
      const stats = await Bun.file(full)
        .stat()
        .then((x) => x.mtime.getTime())
        .catch(() => 0)

      files.push({
        path: full,
        mtime: stats,
      })
    }

    // 按修改时间倒序排序（最新的在前）
    files.sort((a, b) => b.mtime - a.mtime)

    // 构建输出
    const output = []
    if (files.length === 0) output.push("No files found")
    if (files.length > 0) {
      // 添加每个文件的路径
      output.push(...files.map((f) => f.path))
      // 如果截断，添加提示
      if (truncated) {
        output.push("")
        output.push("(Results are truncated. Consider using a more specific path or pattern.)")
      }
    }

    return {
      // 使用相对路径作为标题
      title: path.relative(Instance.worktree, search),
      metadata: {
        count: files.length,
        truncated,
      },
      output: output.join("\n"),
    }
  },
})
