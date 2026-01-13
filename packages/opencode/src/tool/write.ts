/**
 * ============================================================================
 * 文件名：write.ts
 * 所属包：packages/opencode/src/tool
 * ============================================================================
 *
 * 文件作用：
 * Write 工具模块。允许 AI 写入或创建文件。
 *
 * 主要功能：
 * - WriteTool：写入文件的工具
 * - 创建新文件或覆盖现有文件
 * - 生成并显示 diff
 * - 检测 LSP 诊断错误
 * - 防止外部修改覆盖
 *
 * 依赖关系：
 * - zod：类型验证
 * - path：路径处理
 * - ./tool：工具基类
 * - ../lsp：LSP 集成
 * - diff：diff 生成
 * - ./write.txt：工具描述模板
 * - ../bus：事件总线
 * - ../file：文件操作
 * - ../file/time：文件时间跟踪
 * - ../util/filesystem：文件系统工具
 * - ../project/instance：实例管理
 * - ./edit：trimDiff 函数
 * - ./external-directory：外部目录检查
 *
 * 导出内容：
 * - WriteTool：写入工具定义
 *
 * 参数：
 * - content：要写入的内容
 * - filePath：文件路径（必须是绝对路径）
 *
 * 返回：
 * - title：相对路径标题
 * - output：写入结果和 LSP 错误
 * - metadata：元数据（诊断、路径、是否已存在）
 *
 * LSP 集成：
 * - 写入后触发 LSP 诊断
 * - 显示检测到的错误
 * - 每个文件最多显示 20 个错误
 * - 整个项目最多显示 5 个文件的错误
 *
 * 安全性：
 * - 文件存在时检查修改时间
 * - 请求 edit 权限
 * - 发布编辑事件
 *
 * @package opencode
 * @module tool/write
 */

// 导入 Zod 类型验证库
import z from "zod"

// 导入路径处理
import * as path from "path"

// 导入工具基类
import { Tool } from "./tool"

// 导入 LSP 集成
import { LSP } from "../lsp"

// 导入 diff 工具
import { createTwoFilesPatch } from "diff"

// 导入工具描述模板
import DESCRIPTION from "./write.txt"

// 导入事件总线
import { Bus } from "../bus"

// 导入文件操作
import { File } from "../file"

// 导入文件时间跟踪
import { FileTime } from "../file/time"

// 导入文件系统工具
import { Filesystem } from "../util/filesystem"

// 导入实例管理
import { Instance } from "../project/instance"

// 导入 trimDiff 函数
import { trimDiff } from "./edit"

// 导入外部目录检查
import { assertExternalDirectory } from "./external-directory"

// 每个文件的最大诊断数
const MAX_DIAGNOSTICS_PER_FILE = 20

// 整个项目诊断的最大文件数
const MAX_PROJECT_DIAGNOSTICS_FILES = 5

/**
 * 写入工具定义
 *
 * 允许 AI 写入或创建文件。
 */
export const WriteTool = Tool.define("write", {
  // 工具描述（从模板导入）
  description: DESCRIPTION,

  // 参数 Schema
  parameters: z.object({
    // 要写入的内容
    content: z.string().describe("The content to write to the file"),
    // 文件路径（必须是绝对路径）
    filePath: z.string().describe("The absolute path to the file to write (must be absolute, not relative)"),
  }),

  async execute(params, ctx) {
    // 解析为绝对路径
    const filepath = path.isAbsolute(params.filePath) ? params.filePath : path.join(Instance.directory, params.filePath)

    // 检查外部目录权限
    await assertExternalDirectory(ctx, filepath)

    // 获取文件信息
    const file = Bun.file(filepath)
    const exists = await file.exists()
    const contentOld = exists ? await file.text() : ""

    // 如果文件存在，检查修改时间
    if (exists) await FileTime.assert(ctx.sessionID, filepath)

    // 生成 diff
    const diff = trimDiff(createTwoFilesPatch(filepath, filepath, contentOld, params.content))

    // 请求 edit 权限
    await ctx.ask({
      permission: "edit",
      patterns: [path.relative(Instance.worktree, filepath)],
      always: ["*"],
      metadata: {
        filepath,
        diff,
      },
    })

    // 写入文件
    await Bun.write(filepath, params.content)

    // 发布编辑事件
    await Bus.publish(File.Event.Edited, {
      file: filepath,
    })

    // 记录读取时间
    FileTime.read(ctx.sessionID, filepath)

    // 基础输出
    let output = "Wrote file successfully."

    // 触发 LSP 诊断
    await LSP.touchFile(filepath, true)
    const diagnostics = await LSP.diagnostics()
    const normalizedFilepath = Filesystem.normalizePath(filepath)

    // 跟踪项目诊断文件数
    let projectDiagnosticsCount = 0

    // 遍历诊断结果
    for (const [file, issues] of Object.entries(diagnostics)) {
      // 只处理错误（severity === 1）
      const errors = issues.filter((item) => item.severity === 1)
      if (errors.length === 0) continue

      // 限制显示的错误数量
      const limited = errors.slice(0, MAX_DIAGNOSTICS_PER_FILE)
      const suffix =
        errors.length > MAX_DIAGNOSTICS_PER_FILE ? `\n... and ${errors.length - MAX_DIAGNOSTICS_PER_FILE} more` : ""

      // 当前文件的错误
      if (file === normalizedFilepath) {
        output += `\n\nLSP errors detected in this file:\n<diagnostics file="${filepath}">\n${limited.map(LSP.Diagnostic.pretty).join("\n")}${suffix}\n</diagnostics>`
        continue
      }

      // 其他文件的错误（限制数量）
      if (projectDiagnosticsCount >= MAX_PROJECT_DIAGNOSTICS_FILES) continue
      projectDiagnosticsCount++
      output += `\n\nLSP errors detected in other files:\n<diagnostics file="${file}">\n${limited.map(LSP.Diagnostic.pretty).join("\n")}${suffix}\n</diagnostics>`
    }

    return {
      // 使用相对路径作为标题
      title: path.relative(Instance.worktree, filepath),
      metadata: {
        diagnostics,
        filepath,
        exists: exists,
      },
      output,
    }
  },
})
