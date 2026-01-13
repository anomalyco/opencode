/**
 * ============================================================================
 * 文件名：patch.ts
 * 所属包：packages/opencode/src/tool
 * ============================================================================
 *
 * 文件作用：
 * Patch 工具模块。允许 AI 应用补丁来修改多个文件。
 *
 * 主要功能：
 * - PatchTool：应用补丁的工具
 * - 支持添加、更新、删除、移动文件
 * - 解析补丁文本并应用更改
 * - 生成并显示 diff
 * - 防止外部修改覆盖
 *
 * 依赖关系：
 * - zod：类型验证
 * - path：路径处理
 * - fs/promises：文件系统操作
 * - ./tool：工具基类
 * - ../file/time：文件时间跟踪
 * - ../bus：事件总线
 * - ../file/watcher：文件监视器
 * - ../project/instance：实例管理
 * - ../patch：补丁解析
 * - diff：diff 生成
 * - ./external-directory：外部目录检查
 *
 * 导出内容：
 * - PatchTool：Patch 工具定义
 *
 * 参数：
 * - patchText：完整的补丁文本
 *
 * 返回：
 * - title：摘要（文件更改数量）
 * - output：应用结果和文件列表
 * - metadata：元数据（diff）
 *
 * 补丁格式：
 * 支持多种操作类型：
 * - add：添加新文件
 * - update：更新现有文件
 * - delete：删除文件
 * - move：移动文件（更新时带 move_path）
 *
 * 行为：
 * - 解析补丁文本为 hunks
 * - 验证文件路径和权限
 * - 生成完整的 diff
 * - 请求 edit 权限
 * - 应用所有更改
 * - 发布文件更改事件
 *
 * 安全性：
 * - 文件存在时检查修改时间
 * - 请求 edit 权限
 * - 创建父目录（如果需要）
 *
 * @package opencode
 * @module tool/patch
 */

// 导入 Zod 类型验证库
import z from "zod"

// 导入路径处理
import * as path from "path"

// 导入文件系统操作
import * as fs from "fs/promises"

// 导入工具基类
import { Tool } from "./tool"

// 导入文件时间跟踪
import { FileTime } from "../file/time"

// 导入事件总线
import { Bus } from "../bus"

// 导入文件监视器
import { FileWatcher } from "../file/watcher"

// 导入实例管理
import { Instance } from "../project/instance"

// 导入补丁解析
import { Patch } from "../patch"

// 导入 diff 工具
import { createTwoFilesPatch } from "diff"

// 导入外部目录检查
import { assertExternalDirectory } from "./external-directory"

// 参数 Schema
const PatchParams = z.object({
  // 补丁文本
  patchText: z.string().describe("The full patch text that describes all changes to be made"),
})

/**
 * Patch 工具定义
 *
 * 允许 AI 应用补丁来修改多个文件。
 */
export const PatchTool = Tool.define("patch", {
  // 工具描述
  description:
    "Apply a patch to modify multiple files. Supports adding, updating, and deleting files with context-aware changes.",
  parameters: PatchParams,

  async execute(params, ctx) {
    // 检查补丁文本是否提供
    if (!params.patchText) {
      throw new Error("patchText is required")
    }

    // 解析补丁为 hunks
    let hunks: Patch.Hunk[]
    try {
      const parseResult = Patch.parsePatch(params.patchText)
      hunks = parseResult.hunks
    } catch (error) {
      throw new Error(`Failed to parse patch: ${error}`)
    }

    // 检查是否有文件更改
    if (hunks.length === 0) {
      throw new Error("No file changes found in patch")
    }

    // 验证文件路径并检查权限
    const fileChanges: Array<{
      filePath: string
      oldContent: string
      newContent: string
      type: "add" | "update" | "delete" | "move"
      movePath?: string
    }> = []

    let totalDiff = ""

    // 处理每个 hunk
    for (const hunk of hunks) {
      const filePath = path.resolve(Instance.directory, hunk.path)
      await assertExternalDirectory(ctx, filePath)

      switch (hunk.type) {
        case "add":
          // 添加新文件
          const oldContent = ""
          const newContent = hunk.contents
          const diff = createTwoFilesPatch(filePath, filePath, oldContent, newContent)

          fileChanges.push({
            filePath,
            oldContent,
            newContent,
            type: "add",
          })

          totalDiff += diff + "\n"
          break

        case "update":
          // 更新现有文件
          // 检查文件是否存在
          const stats = await fs.stat(filePath).catch(() => null)
          if (!stats || stats.isDirectory()) {
            throw new Error(`File not found or is directory: ${filePath}`)
          }

          // 读取文件并更新时间跟踪
          await FileTime.assert(ctx.sessionID, filePath)
          const oldContent = await fs.readFile(filePath, "utf-8")
          let newContent = oldContent

          // 应用更新块获取新内容
          try {
            const fileUpdate = Patch.deriveNewContentsFromChunks(filePath, hunk.chunks)
            newContent = fileUpdate.content
          } catch (error) {
            throw new Error(`Failed to apply update to ${filePath}: ${error}`)
          }

          const diff = createTwoFilesPatch(filePath, filePath, oldContent, newContent)

          // 处理移动操作
          const movePath = hunk.move_path ? path.resolve(Instance.directory, hunk.move_path) : undefined
          await assertExternalDirectory(ctx, movePath)

          fileChanges.push({
            filePath,
            oldContent,
            newContent,
            type: hunk.move_path ? "move" : "update",
            movePath,
          })

          totalDiff += diff + "\n"
          break

        case "delete":
          // 删除文件
          await FileTime.assert(ctx.sessionID, filePath)
          const contentToDelete = await fs.readFile(filePath, "utf-8")
          const deleteDiff = createTwoFilesPatch(filePath, filePath, contentToDelete, "")

          fileChanges.push({
            filePath,
            oldContent: contentToDelete,
            newContent: "",
            type: "delete",
          })

          totalDiff += deleteDiff + "\n"
          break
      }
    }

    // 请求 edit 权限
    await ctx.ask({
      permission: "edit",
      patterns: fileChanges.map((c) => path.relative(Instance.worktree, c.filePath)),
      always: ["*"],
      metadata: {
        diff: totalDiff,
      },
    })

    // 应用更改
    const changedFiles: string[] = []

    for (const change of fileChanges) {
      switch (change.type) {
        case "add":
          // 创建父目录
          const addDir = path.dirname(change.filePath)
          if (addDir !== "." && addDir !== "/") {
            await fs.mkdir(addDir, { recursive: true })
          }
          await fs.writeFile(change.filePath, change.newContent, "utf-8")
          changedFiles.push(change.filePath)
          break

        case "update":
          await fs.writeFile(change.filePath, change.newContent, "utf-8")
          changedFiles.push(change.filePath)
          break

        case "move":
          if (change.movePath) {
            // 为目标创建父目录
            const moveDir = path.dirname(change.movePath)
            if (moveDir !== "." && moveDir !== "/") {
              await fs.mkdir(moveDir, { recursive: true })
            }
            // 写入新位置
            await fs.writeFile(change.movePath, change.newContent, "utf-8")
            // 删除原文件
            await fs.unlink(change.filePath)
            changedFiles.push(change.movePath)
          }
          break

        case "delete":
          await fs.unlink(change.filePath)
          changedFiles.push(change.filePath)
          break
      }

      // 更新文件时间跟踪
      FileTime.read(ctx.sessionID, change.filePath)
      if (change.movePath) {
        FileTime.read(ctx.sessionID, change.movePath)
      }
    }

    // 发布文件更改事件
    for (const filePath of changedFiles) {
      await Bus.publish(FileWatcher.Event.Updated, { file: filePath, event: "change" })
    }

    // 生成输出摘要
    const relativePaths = changedFiles.map((filePath) => path.relative(Instance.worktree, filePath))
    const summary = `${fileChanges.length} files changed`

    return {
      title: summary,
      metadata: {
        diff: totalDiff,
      },
      output: `Patch applied successfully. ${summary}:\n${relativePaths.map((p) => `  ${p}`).join("\n")}`,
    }
  },
})
