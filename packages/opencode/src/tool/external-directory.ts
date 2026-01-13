/**
 * ============================================================================
 * 文件名：external-directory.ts
 * 所属包：packages/opencode/src/tool
 * ============================================================================
 *
 * 文件作用：
 * 外部目录检查模块。用于检查和请求外部目录的访问权限。
 *
 * 主要功能：
 * - assertExternalDirectory()：检查外部目录权限
 * - 如果路径在实例内，跳过检查
 * - 如果路径在实例外，请求 external_directory 权限
 *
 * 依赖关系：
 * - path：路径处理
 * - ./tool：工具基类（类型导入）
 * - ../project/instance：实例管理
 *
 * 导出内容：
 * - assertExternalDirectory()：检查外部目录权限函数
 *
 * 参数：
 * - ctx：工具上下文
 * - target：目标路径（可选）
 * - options：选项
 *   - bypass：是否跳过检查
 *   - kind：路径类型（file/directory）
 *
 * 行为：
 * 1. 如果没有目标路径，直接返回
 * 2. 如果设置了 bypass 选项，跳过检查
 * 3. 如果路径在实例内，跳过检查
 * 4. 否则请求 external_directory 权限
 *
 * 权限请求：
 * - permission：external_directory
 * - patterns：父目录的 glob 模式
 * - always：相同的 glob 模式
 * - metadata：包含 filepath 和 parentDir
 *
 * @package opencode
 * @module tool/external-directory
 */

// 导入路径处理
import path from "path"

// 导入工具基类（类型导入）
import type { Tool } from "./tool"

// 导入实例管理
import { Instance } from "../project/instance"

// 路径类型
type Kind = "file" | "directory"

// 选项类型
type Options = {
  // 是否跳过检查
  bypass?: boolean
  // 路径类型
  kind?: Kind
}

/**
 * 检查外部目录权限
 *
 * 如果目标路径在实例外部，请求 external_directory 权限。
 *
 * @param ctx - 工具上下文
 * @param target - 目标路径（可选）
 * @param options - 选项
 *
 * 行为说明：
 * 1. 如果没有目标路径，直接返回
 * 2. 如果设置了 bypass 选项，跳过检查
 * 3. 如果路径在实例内（通过 Instance.containsPath 检查），跳过检查
 * 4. 否则请求 external_directory 权限
 *
 * 权限请求：
 * - patterns：父目录的 glob 模式（parentDir/*）
 * - always：相同的 glob 模式
 * - metadata：包含 filepath 和 parentDir
 */
export async function assertExternalDirectory(ctx: Tool.Context, target?: string, options?: Options) {
  // 如果没有目标路径，直接返回
  if (!target) return

  // 如果设置了 bypass 选项，跳过检查
  if (options?.bypass) return

  // 如果路径在实例内，跳过检查
  if (Instance.containsPath(target)) return

  // 确定路径类型（默认为 file）
  const kind = options?.kind ?? "file"

  // 计算父目录
  const parentDir = kind === "directory" ? target : path.dirname(target)

  // 构建 glob 模式
  const glob = path.join(parentDir, "*")

  // 请求 external_directory 权限
  await ctx.ask({
    permission: "external_directory",
    patterns: [glob],
    always: [glob],
    metadata: {
      filepath: target,
      parentDir,
    },
  })
}
