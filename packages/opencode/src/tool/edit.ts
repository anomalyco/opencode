/**
 * ============================================================================
 * 文件名：edit.ts
 * 所属包：packages/opencode/src/tool
 * ============================================================================
 *
 * 文件作用：
 * Edit 工具模块。允许 AI 对文件进行精确的编辑操作，使用多种替换策略来处理不同的文本匹配场景。
 *
 * 主要功能：
 * - EditTool：编辑文件的工具
 * - 多种替换策略（Replacer）处理不同的文本匹配场景
 * - 支持精确匹配和模糊匹配
 * - 生成并显示 diff
 * - 检测 LSP 诊断错误
 * - 防止外部修改覆盖
 *
 * 依赖关系：
 * - zod：类型验证
 * - path：路径处理
 * - ./tool：工具基类
 * - ../lsp：LSP 集成
 * - diff：diff 生成（createTwoFilesPatch, diffLines）
 * - ./edit.txt：工具描述模板
 * - ../file：文件操作
 * - ../bus：事件总线
 * - ../file/time：文件时间跟踪
 * - ../util/filesystem：文件系统工具
 * - ../project/instance：实例管理
 * - ../snapshot：快照管理
 * - ./external-directory：外部目录检查
 *
 * 导出内容：
 * - EditTool：编辑工具定义
 * - Replacer：替换器类型
 * - replace()：主替换函数
 * - trimDiff()：diff 清理函数
 * - 多种 Replacer 实现：
 *   - SimpleReplacer：简单精确匹配
 *   - LineTrimmedReplacer：行修剪匹配
 *   - BlockAnchorReplacer：块锚点匹配（使用 Levenshtein 距离）
 *   - WhitespaceNormalizedReplacer：空白标准化匹配
 *   - IndentationFlexibleReplacer：缩进灵活匹配
 *   - EscapeNormalizedReplacer：转义标准化匹配
 *   - MultiOccurrenceReplacer：多出现匹配
 *   - TrimmedBoundaryReplacer：边界修剪匹配
 *   - ContextAwareReplacer：上下文感知匹配
 * - levenshtein()：Levenshtein 距离算法
 *
 * 参数：
 * - filePath：文件路径（必须是绝对路径）
 * - oldString：要替换的文本
 * - newString：替换后的文本（必须与 oldString 不同）
 * - replaceAll：是否替换所有出现（默认 false）
 *
 * 返回：
 * - title：相对路径标题
 * - output：编辑结果和 LSP 错误
 * - metadata：元数据（diff、文件差异、诊断）
 *
 * 常量：
 * - MAX_DIAGNOSTICS_PER_FILE：每个文件最大诊断数（20）
 * - SINGLE_CANDIDATE_SIMILARITY_THRESHOLD：单个候选相似度阈值（0.0）
 * - MULTIPLE_CANDIDATES_SIMILARITY_THRESHOLD：多个候选相似度阈值（0.3）
 *
 * 替换策略：
 * 按顺序尝试每种策略，找到第一个成功匹配后立即返回：
 * 1. SimpleReplacer - 精确匹配
 * 2. LineTrimmedReplacer - 行修剪后匹配
 * 3. BlockAnchorReplacer - 使用首尾锚点匹配
 * 4. WhitespaceNormalizedReplacer - 空白标准化后匹配
 * 5. IndentationFlexibleReplacer - 忽略缩进匹配
 * 6. EscapeNormalizedReplacer - 转义字符标准化后匹配
 * 7. TrimmedBoundaryReplacer - 边界修剪后匹配
 * 8. ContextAwareReplacer - 上下文感知匹配
 * 9. MultiOccurrenceReplacer - 处理多个出现
 *
 * 算法：
 * - Levenshtein 距离：用于计算两个字符串之间的编辑距离
 * - 动态规划实现，时间复杂度 O(m*n)
 *
 * @package opencode
 * @module tool/edit
 */

// 编辑工具中的方法来源于以下项目：
// https://github.com/cline/cline/blob/main/evals/diff-edits/diff-apply/diff-06-23-25.ts
// https://github.com/google-gemini/gemini-cli/blob/main/packages/core/src/utils/editCorrector.ts
// https://github.com/cline/cline/blob/main/evals/diff-edits/diff-apply/diff-06-26-25.ts

// 导入 Zod 类型验证库
import z from "zod"

// 导入路径处理
import * as path from "path"

// 导入工具基类
import { Tool } from "./tool"

// 导入 LSP 集成
import { LSP } from "../lsp"

// 导入 diff 工具
import { createTwoFilesPatch, diffLines } from "diff"

// 导入工具描述模板
import DESCRIPTION from "./edit.txt"

// 导入文件操作
import { File } from "../file"

// 导入事件总线
import { Bus } from "../bus"

// 导入文件时间跟踪
import { FileTime } from "../file/time"

// 导入文件系统工具
import { Filesystem } from "../util/filesystem"

// 导入实例管理
import { Instance } from "../project/instance"

// 导入快照管理
import { Snapshot } from "@/snapshot"

// 导入外部目录检查
import { assertExternalDirectory } from "./external-directory"

// 每个文件的最大诊断数
const MAX_DIAGNOSTICS_PER_FILE = 20

/**
 * 标准化行尾符
 *
 * 将 Windows 风格的行尾符（\r\n）转换为 Unix 风格（\n）。
 *
 * @param text - 要处理的文本
 * @returns 标准化后的文本
 */
function normalizeLineEndings(text: string): string {
  // 将所有 \r\n 替换为 \n
  return text.replaceAll("\r\n", "\n")
}

/**
 * 编辑工具定义
 *
 * 允许 AI 对文件进行精确的编辑操作。
 */
export const EditTool = Tool.define("edit", {
  // 工具描述（从模板导入）
  description: DESCRIPTION,

  // 参数 Schema
  parameters: z.object({
    // 文件路径（必须是绝对路径）
    filePath: z.string().describe("The absolute path to the file to modify"),
    // 要替换的文本
    oldString: z.string().describe("The text to replace"),
    // 替换后的文本（必须与 oldString 不同）
    newString: z.string().describe("The text to replace it with (must be different from oldString)"),
    // 是否替换所有出现
    replaceAll: z.boolean().optional().describe("Replace all occurrences of oldString (default false)"),
  }),

  async execute(params, ctx) {
    // 检查 filePath 是否提供
    if (!params.filePath) {
      throw new Error("filePath is required")
    }

    // 检查 oldString 和 newString 是否不同
    if (params.oldString === params.newString) {
      throw new Error("oldString and newString must be different")
    }

    // 解析为绝对路径
    const filePath = path.isAbsolute(params.filePath) ? params.filePath : path.join(Instance.directory, params.filePath)

    // 检查外部目录权限
    await assertExternalDirectory(ctx, filePath)

    // 初始化变量
    let diff = ""
    let contentOld = ""
    let contentNew = ""

    // 使用文件锁保护编辑操作
    await FileTime.withLock(filePath, async () => {
      // 如果 oldString 为空，表示创建新文件
      if (params.oldString === "") {
        // 新文件内容就是 newString
        contentNew = params.newString
        // 生成 diff
        diff = trimDiff(createTwoFilesPatch(filePath, filePath, contentOld, contentNew))

        // 请求 edit 权限
        await ctx.ask({
          permission: "edit",
          patterns: [path.relative(Instance.worktree, filePath)],
          always: ["*"],
          metadata: {
            filepath: filePath,
            diff,
          },
        })

        // 写入文件
        await Bun.write(filePath, params.newString)

        // 发布编辑事件
        await Bus.publish(File.Event.Edited, {
          file: filePath,
        })

        // 记录读取时间
        FileTime.read(ctx.sessionID, filePath)
        return
      }

      // 获取文件信息
      const file = Bun.file(filePath)
      const stats = await file.stat().catch(() => {})

      // 文件不存在
      if (!stats) throw new Error(`File ${filePath} not found`)

      // 路径是目录而非文件
      if (stats.isDirectory()) throw new Error(`Path is a directory, not a file: ${filePath}`)

      // 检查修改时间（防止外部修改覆盖）
      await FileTime.assert(ctx.sessionID, filePath)

      // 读取旧内容
      contentOld = await file.text()

      // 执行替换
      contentNew = replace(contentOld, params.oldString, params.newString, params.replaceAll)

      // 生成 diff（使用标准化行尾）
      diff = trimDiff(
        createTwoFilesPatch(filePath, filePath, normalizeLineEndings(contentOld), normalizeLineEndings(contentNew)),
      )

      // 请求 edit 权限
      await ctx.ask({
        permission: "edit",
        patterns: [path.relative(Instance.worktree, filePath)],
        always: ["*"],
        metadata: {
          filepath: filePath,
          diff,
        },
      })

      // 写入新内容
      await file.write(contentNew)

      // 发布编辑事件
      await Bus.publish(File.Event.Edited, {
        file: filePath,
      })

      // 重新读取内容以确认写入
      contentNew = await file.text()

      // 重新生成 diff（使用实际写入后的内容）
      diff = trimDiff(
        createTwoFilesPatch(filePath, filePath, normalizeLineEndings(contentOld), normalizeLineEndings(contentNew)),
      )

      // 记录读取时间
      FileTime.read(ctx.sessionID, filePath)
    })

    // 构建文件差异对象
    const filediff: Snapshot.FileDiff = {
      file: filePath,
      before: contentOld,
      after: contentNew,
      additions: 0,
      deletions: 0,
    }

    // 计算添加和删除的行数
    for (const change of diffLines(contentOld, contentNew)) {
      if (change.added) filediff.additions += change.count || 0
      if (change.removed) filediff.deletions += change.count || 0
    }

    // 更新元数据
    ctx.metadata({
      metadata: {
        diff,
        filediff,
        diagnostics: {},
      },
    })

    // 基础输出
    let output = "Edit applied successfully."

    // 触发 LSP 诊断
    await LSP.touchFile(filePath, true)
    const diagnostics = await LSP.diagnostics()
    const normalizedFilePath = Filesystem.normalizePath(filePath)
    const issues = diagnostics[normalizedFilePath] ?? []
    const errors = issues.filter((item) => item.severity === 1)

    // 如果有错误，添加到输出
    if (errors.length > 0) {
      const limited = errors.slice(0, MAX_DIAGNOSTICS_PER_FILE)
      const suffix =
        errors.length > MAX_DIAGNOSTICS_PER_FILE ? `\n... and ${errors.length - MAX_DIAGNOSTICS_PER_FILE} more` : ""
      output += `\n\nLSP errors detected in this file:\n<diagnostics file="${filePath}">\n${limited.map(LSP.Diagnostic.pretty).join("\n")}${suffix}\n</diagnostics>`
    }

    return {
      metadata: {
        diagnostics,
        diff,
        filediff,
      },
      // 使用相对路径作为标题
      title: `${path.relative(Instance.worktree, filePath)}`,
      output,
    }
  },
})

/**
 * 替换器类型
 *
 * 替换器是一个生成器函数，接收内容和查找字符串，
 * 生成所有可能的匹配结果。
 */
export type Replacer = (content: string, find: string) => Generator<string, void, unknown>

// 单个候选的相似度阈值（宽松，任何相似度都接受）
const SINGLE_CANDIDATE_SIMILARITY_THRESHOLD = 0.0

// 多个候选的相似度阈值（严格，需要 30% 以上相似度）
const MULTIPLE_CANDIDATES_SIMILARITY_THRESHOLD = 0.3

/**
 * Levenshtein 距离算法实现
 *
 * 计算两个字符串之间的编辑距离，即从一个字符串转换到另一个字符串
 * 所需的最少单字符编辑（插入、删除、替换）次数。
 *
 * 使用动态规划实现，时间复杂度 O(m*n)，空间复杂度 O(m*n)。
 *
 * @param a - 第一个字符串
 * @param b - 第二个字符串
 * @returns 编辑距离
 *
 * 算法说明：
 * 1. 创建一个 (m+1) x (n+1) 的矩阵
 * 2. 矩阵的第一行和第一列初始化为 0 到 m 和 0 到 n
 * 3. 对于每个位置 (i, j)，计算最小编辑距离：
 *    - 如果字符相同，代价为 0，否则为 1
 *    - 取以下三个值的最小值：
 *      - 上方值 + 1（删除）
 *      - 左方值 + 1（插入）
 *      - 左上方值 + 代价（替换或保持）
 * 4. 返回矩阵右下角的值
 */
function levenshtein(a: string, b: string): number {
  // 处理空字符串情况
  if (a === "" || b === "") {
    return Math.max(a.length, b.length)
  }

  // 创建动态规划矩阵
  const matrix = Array.from({ length: a.length + 1 }, (_, i) =>
    Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)),
  )

  // 填充矩阵
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      // 计算字符替换代价（相同为 0，不同为 1）
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      // 取三种操作的最小值
      matrix[i][j] = Math.min(matrix[i - 1][j] + 1, matrix[i][j - 1] + 1, matrix[i - 1][j - 1] + cost)
    }
  }

  // 返回右下角的值（最小编辑距离）
  return matrix[a.length][b.length]
}

/**
 * 简单替换器
 *
 * 直接返回查找字符串，用于精确匹配。
 *
 * @param _content - 原始内容（未使用）
 * @param find - 要查找的字符串
 * @yields 精确匹配的字符串
 */
export const SimpleReplacer: Replacer = function* (_content, find) {
  yield find
}

/**
 * 行修剪替换器
 *
 * 忽略每行前后的空白字符进行匹配。
 * 适用于 AI 提供的代码片段有额外缩进的情况。
 *
 * @param content - 原始内容
 * @param find - 要查找的字符串
 * @yields 修剪后匹配的原始内容块
 *
 * 算法说明：
 * 1. 将内容和查找字符串按行分割
 * 2. 移除查找字符串末尾的空行（如果有）
 * 3. 遍历所有可能的起始位置
 * 4. 对每个位置，检查逐行修剪后是否匹配
 * 5. 如果匹配，计算并返回原始内容中的对应块
 */
export const LineTrimmedReplacer: Replacer = function* (content, find) {
  // 将原始内容按行分割
  const originalLines = content.split("\n")
  // 将查找字符串按行分割
  const searchLines = find.split("\n")

  // 如果查找字符串末尾是空行，移除它
  if (searchLines[searchLines.length - 1] === "") {
    searchLines.pop()
  }

  // 遍历所有可能的起始位置
  for (let i = 0; i <= originalLines.length - searchLines.length; i++) {
    let matches = true

    // 逐行比较修剪后的内容
    for (let j = 0; j < searchLines.length; j++) {
      const originalTrimmed = originalLines[i + j].trim()
      const searchTrimmed = searchLines[j].trim()

      // 如果修剪后不匹配，标记为不匹配
      if (originalTrimmed !== searchTrimmed) {
        matches = false
        break
      }
    }

    // 如果所有行都匹配
    if (matches) {
      // 计算匹配块在原始内容中的起始索引
      let matchStartIndex = 0
      for (let k = 0; k < i; k++) {
        matchStartIndex += originalLines[k].length + 1
      }

      // 计算匹配块在原始内容中的结束索引
      let matchEndIndex = matchStartIndex
      for (let k = 0; k < searchLines.length; k++) {
        matchEndIndex += originalLines[i + k].length
        // 除了最后一行，每行后加 1（换行符）
        if (k < searchLines.length - 1) {
          matchEndIndex += 1
        }
      }

      // 返回原始内容中的匹配块
      yield content.substring(matchStartIndex, matchEndIndex)
    }
  }
}

/**
 * 块锚点替换器
 *
 * 使用首尾行作为锚点进行匹配，中间行使用 Levenshtein 距离计算相似度。
 * 适用于代码块可能有少量修改的情况。
 *
 * @param content - 原始内容
 * @param find - 要查找的字符串
 * @yields 匹配的原始内容块
 *
 * 算法说明：
 * 1. 查找字符串至少需要 3 行
 * 2. 使用首尾行修剪后的内容作为锚点
 * 3. 找到所有匹配首尾锚点的候选位置
 * 4. 如果只有一个候选，使用宽松阈值（0.0）
 * 5. 如果有多个候选，使用严格阈值（0.3）并选择最相似的
 * 6. 使用 Levenshtein 距离计算中间行的相似度
 */
export const BlockAnchorReplacer: Replacer = function* (content, find) {
  // 将原始内容按行分割
  const originalLines = content.split("\n")
  // 将查找字符串按行分割
  const searchLines = find.split("\n")

  // 查找字符串至少需要 3 行
  if (searchLines.length < 3) {
    return
  }

  // 移除查找字符串末尾的空行
  if (searchLines[searchLines.length - 1] === "") {
    searchLines.pop()
  }

  // 获取首尾锚点（修剪后）
  const firstLineSearch = searchLines[0].trim()
  const lastLineSearch = searchLines[searchLines.length - 1].trim()
  const searchBlockSize = searchLines.length

  // 收集所有候选位置（首尾锚点都匹配）
  const candidates: Array<{ startLine: number; endLine: number }> = []

  // 遍历所有可能的起始行
  for (let i = 0; i < originalLines.length; i++) {
    // 检查首行锚点是否匹配
    if (originalLines[i].trim() !== firstLineSearch) {
      continue
    }

    // 在首行之后查找匹配的尾行锚点
    for (let j = i + 2; j < originalLines.length; j++) {
      if (originalLines[j].trim() === lastLineSearch) {
        candidates.push({ startLine: i, endLine: j })
        break // 只匹配第一个出现的尾行
      }
    }
  }

  // 如果没有候选，直接返回
  if (candidates.length === 0) {
    return
  }

  // 处理单个候选的情况（使用宽松阈值）
  if (candidates.length === 1) {
    const { startLine, endLine } = candidates[0]
    const actualBlockSize = endLine - startLine + 1

    // 计算相似度
    let similarity = 0
    // 只检查中间行
    let linesToCheck = Math.min(searchBlockSize - 2, actualBlockSize - 2)

    if (linesToCheck > 0) {
      // 逐行计算相似度
      for (let j = 1; j < searchBlockSize - 1 && j < actualBlockSize - 1; j++) {
        const originalLine = originalLines[startLine + j].trim()
        const searchLine = searchLines[j].trim()
        const maxLen = Math.max(originalLine.length, searchLine.length)
        if (maxLen === 0) {
          continue
        }
        // 计算 Levenshtein 距离并转换为相似度
        const distance = levenshtein(originalLine, searchLine)
        similarity += (1 - distance / maxLen) / linesToCheck

        // 达到阈值后提前退出
        if (similarity >= SINGLE_CANDIDATE_SIMILARITY_THRESHOLD) {
          break
        }
      }
    } else {
      // 没有中间行可比较，仅基于锚点接受
      similarity = 1.0
    }

    // 检查相似度是否满足阈值
    if (similarity >= SINGLE_CANDIDATE_SIMILARITY_THRESHOLD) {
      // 计算匹配块的起始索引
      let matchStartIndex = 0
      for (let k = 0; k < startLine; k++) {
        matchStartIndex += originalLines[k].length + 1
      }

      // 计算匹配块的结束索引
      let matchEndIndex = matchStartIndex
      for (let k = startLine; k <= endLine; k++) {
        matchEndIndex += originalLines[k].length
        if (k < endLine) {
          matchEndIndex += 1
        }
      }

      // 返回匹配的原始内容
      yield content.substring(matchStartIndex, matchEndIndex)
    }
    return
  }

  // 处理多个候选的情况，计算相似度并选择最佳匹配
  let bestMatch: { startLine: number; endLine: number } | null = null
  let maxSimilarity = -1

  // 遍历所有候选
  for (const candidate of candidates) {
    const { startLine, endLine } = candidate
    const actualBlockSize = endLine - startLine + 1

    // 计算相似度
    let similarity = 0
    // 只检查中间行
    let linesToCheck = Math.min(searchBlockSize - 2, actualBlockSize - 2)

    if (linesToCheck > 0) {
      // 逐行计算相似度
      for (let j = 1; j < searchBlockSize - 1 && j < actualBlockSize - 1; j++) {
        const originalLine = originalLines[startLine + j].trim()
        const searchLine = searchLines[j].trim()
        const maxLen = Math.max(originalLine.length, searchLine.length)
        if (maxLen === 0) {
          continue
        }
        // 计算 Levenshtein 距离并转换为相似度
        const distance = levenshtein(originalLine, searchLine)
        similarity += 1 - distance / maxLen
      }
      // 计算平均相似度
      similarity /= linesToCheck
    } else {
      // 没有中间行可比较，仅基于锚点接受
      similarity = 1.0
    }

    // 更新最佳匹配
    if (similarity > maxSimilarity) {
      maxSimilarity = similarity
      bestMatch = candidate
    }
  }

  // 阈值判断
  if (maxSimilarity >= MULTIPLE_CANDIDATES_SIMILARITY_THRESHOLD && bestMatch) {
    const { startLine, endLine } = bestMatch

    // 计算匹配块的起始索引
    let matchStartIndex = 0
    for (let k = 0; k < startLine; k++) {
      matchStartIndex += originalLines[k].length + 1
    }

    // 计算匹配块的结束索引
    let matchEndIndex = matchStartIndex
    for (let k = startLine; k <= endLine; k++) {
      matchEndIndex += originalLines[k].length
      if (k < endLine) {
        matchEndIndex += 1
      }
    }

    // 返回最佳匹配的原始内容
    yield content.substring(matchStartIndex, matchEndIndex)
  }
}

/**
 * 空白标准化替换器
 *
 * 将所有连续空白字符标准化为单个空格后进行匹配。
 * 适用于空白字符不规则的情况。
 *
 * @param content - 原始内容
 * @param find - 要查找的字符串
 * @yields 匹配的原始内容块
 *
 * 算法说明：
 * 1. 定义空白标准化函数（将连续空白替换为单个空格并修剪）
 * 2. 处理单行匹配（逐行比较标准化后的内容）
 * 3. 处理多行匹配（将多行拼接后比较）
 * 4. 对于子串匹配，使用正则表达式在原始行中查找
 */
export const WhitespaceNormalizedReplacer: Replacer = function* (content, find) {
  // 空白标准化函数：将连续空白替换为单个空格并修剪
  const normalizeWhitespace = (text: string) => text.replace(/\s+/g, " ").trim()
  const normalizedFind = normalizeWhitespace(find)

  // 处理单行匹配
  const lines = content.split("\n")
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]

    // 检查整行是否匹配
    if (normalizeWhitespace(line) === normalizedFind) {
      yield line
    } else {
      // 如果整行不匹配，检查是否包含标准化的查找字符串
      const normalizedLine = normalizeWhitespace(line)
      if (normalizedLine.includes(normalizedFind)) {
        // 在原始行中查找匹配的子串
        const words = find.trim().split(/\s+/)
        if (words.length > 0) {
          // 构建正则表达式模式（转义特殊字符）
          const pattern = words.map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("\\s+")
          try {
            const regex = new RegExp(pattern)
            const match = line.match(regex)
            if (match) {
              yield match[0]
            }
          } catch (e) {
            // 无效的正则表达式，跳过
          }
        }
      }
    }
  }

  // 处理多行匹配
  const findLines = find.split("\n")
  if (findLines.length > 1) {
    for (let i = 0; i <= lines.length - findLines.length; i++) {
      const block = lines.slice(i, i + findLines.length)
      if (normalizeWhitespace(block.join("\n")) === normalizedFind) {
        yield block.join("\n")
      }
    }
  }
}

/**
 * 缩进灵活替换器
 *
 * 移除每行的公共缩进后进行匹配。
 * 适用于缩进不一致但内容相同的情况。
 *
 * @param content - 原始内容
 * @param find - 要查找的字符串
 * @yields 匹配的原始内容块
 *
 * 算法说明：
 * 1. 定义缩进移除函数（找到最小缩进并移除）
 * 2. 移除查找字符串的缩进作为标准化模式
 * 3. 遍历所有可能的块，移除缩进后比较
 */
export const IndentationFlexibleReplacer: Replacer = function* (content, find) {
  // 缩进移除函数
  const removeIndentation = (text: string) => {
    const lines = text.split("\n")
    // 过滤出非空行
    const nonEmptyLines = lines.filter((line) => line.trim().length > 0)
    if (nonEmptyLines.length === 0) return text

    // 计算最小缩进
    const minIndent = Math.min(
      ...nonEmptyLines.map((line) => {
        const match = line.match(/^(\s*)/)
        return match ? match[1].length : 0
      }),
    )

    // 移除最小缩进
    return lines.map((line) => (line.trim().length === 0 ? line : line.slice(minIndent))).join("\n")
  }

  // 移除查找字符串的缩进
  const normalizedFind = removeIndentation(find)
  const contentLines = content.split("\n")
  const findLines = find.split("\n")

  // 遍历所有可能的块
  for (let i = 0; i <= contentLines.length - findLines.length; i++) {
    const block = contentLines.slice(i, i + findLines.length).join("\n")
    // 移除缩进后比较
    if (removeIndentation(block) === normalizedFind) {
      yield block
    }
  }
}

/**
 * 转义标准化替换器
 *
 * 处理转义字符的标准化，如 \n, \t, \r 等。
 * 适用于 AI 提供的字符串包含转义字符的情况。
 *
 * @param content - 原始内容
 * @param find - 要查找的字符串
 * @yields 匹配的原始内容块
 *
 * 算法说明：
 * 1. 定义转义字符反转义函数
 * 2. 对查找字符串进行反转义
 * 3. 尝试直接匹配反转义后的字符串
 * 4. 尝试对内容进行反转义后匹配
 */
export const EscapeNormalizedReplacer: Replacer = function* (content, find) {
  // 转义字符反转义函数
  const unescapeString = (str: string): string => {
    return str.replace(/\\(n|t|r|'|"|`|\\|\n|\$)/g, (match, capturedChar) => {
      switch (capturedChar) {
        case "n":
          return "\n"
        case "t":
          return "\t"
        case "r":
          return "\r"
        case "'":
          return "'"
        case '"':
          return '"'
        case "`":
          return "`"
        case "\\":
          return "\\"
        case "\n":
          return "\n"
        case "$":
          return "$"
        default:
          return match
      }
    })
  }

  // 对查找字符串进行反转义
  const unescapedFind = unescapeString(find)

  // 尝试直接匹配反转义后的字符串
  if (content.includes(unescapedFind)) {
    yield unescapedFind
  }

  // 尝试在内容中查找转义版本
  const lines = content.split("\n")
  const findLines = unescapedFind.split("\n")

  for (let i = 0; i <= lines.length - findLines.length; i++) {
    const block = lines.slice(i, i + findLines.length).join("\n")
    const unescapedBlock = unescapeString(block)

    if (unescapedBlock === unescapedFind) {
      yield block
    }
  }
}

/**
 * 多出现替换器
 *
 * 生成所有精确匹配的出现位置。
 * 配合 replaceAll 参数处理多个出现的情况。
 *
 * @param content - 原始内容
 * @param find - 要查找的字符串
 * @yields 查找字符串本身（所有出现）
 *
 * 算法说明：
 * 1. 从起始位置开始查找
 * 2. 找到第一个出现后，更新起始位置
 * 3. 继续查找直到找不到更多匹配
 */
export const MultiOccurrenceReplacer: Replacer = function* (content, find) {
  // 这个替换器生成所有精确匹配，允许 replace 函数
  // 根据 replaceAll 参数处理多个出现
  let startIndex = 0

  while (true) {
    // 从起始位置查找
    const index = content.indexOf(find, startIndex)
    if (index === -1) break

    // 生成匹配
    yield find

    // 更新起始位置到匹配之后
    startIndex = index + find.length
  }
}

/**
 * 边界修剪替换器
 *
 * 处理查找字符串前后有额外空白的情况。
 * 首先尝试修剪后的字符串，然后尝试块匹配。
 *
 * @param content - 原始内容
 * @param find - 要查找的字符串
 * @yields 匹配的原始内容块
 */
export const TrimmedBoundaryReplacer: Replacer = function* (content, find) {
  // 修剪查找字符串
  const trimmedFind = find.trim()

  // 如果已经修剪过，无需尝试
  if (trimmedFind === find) {
    return
  }

  // 尝试查找修剪后的版本
  if (content.includes(trimmedFind)) {
    yield trimmedFind
  }

  // 尝试查找修剪后匹配的块
  const lines = content.split("\n")
  const findLines = find.split("\n")

  for (let i = 0; i <= lines.length - findLines.length; i++) {
    const block = lines.slice(i, i + findLines.length).join("\n")

    if (block.trim() === trimmedFind) {
      yield block
    }
  }
}

/**
 * 上下文感知替换器
 *
 * 使用首尾行作为上下文锚点，中间行需要至少 50% 匹配。
 * 适用于需要更多上下文来确定匹配的情况。
 *
 * @param content - 原始内容
 * @param find - 要查找的字符串
 * @yields 匹配的原始内容块
 *
 * 算法说明：
 * 1. 查找字符串至少需要 3 行
 * 2. 使用首尾行作为上下文锚点
 * 3. 找到匹配首尾锚点的块
 * 4. 检查中间行的匹配比例（至少 50%）
 */
export const ContextAwareReplacer: Replacer = function* (content, find) {
  const findLines = find.split("\n")
  // 至少需要 3 行才有有意义的上下文
  if (findLines.length < 3) {
    return
  }

  // 移除末尾空行
  if (findLines[findLines.length - 1] === "") {
    findLines.pop()
  }

  const contentLines = content.split("\n")

  // 提取首尾行作为上下文锚点
  const firstLine = findLines[0].trim()
  const lastLine = findLines[findLines.length - 1].trim()

  // 查找以上下文锚点开始和结束的块
  for (let i = 0; i < contentLines.length; i++) {
    if (contentLines[i].trim() !== firstLine) continue

    // 查找匹配的尾行
    for (let j = i + 2; j < contentLines.length; j++) {
      if (contentLines[j].trim() === lastLine) {
        // 找到潜在的上下文块
        const blockLines = contentLines.slice(i, j + 1)
        const block = blockLines.join("\n")

        // 检查中间内容是否有合理的相似度
        if (blockLines.length === findLines.length) {
          let matchingLines = 0
          let totalNonEmptyLines = 0

          // 统计匹配的非空行
          for (let k = 1; k < blockLines.length - 1; k++) {
            const blockLine = blockLines[k].trim()
            const findLine = findLines[k].trim()

            if (blockLine.length > 0 || findLine.length > 0) {
              totalNonEmptyLines++
              if (blockLine === findLine) {
                matchingLines++
              }
            }
          }

          // 至少 50% 的非空行需要匹配
          if (totalNonEmptyLines === 0 || matchingLines / totalNonEmptyLines >= 0.5) {
            yield block
            break // 只匹配第一个出现
          }
        }
        break
      }
    }
  }
}

/**
 * 清理 diff 输出
 *
 * 移除 diff 中的公共缩进，使差异更清晰易读。
 *
 * @param diff - 原始 diff 字符串
 * @returns 清理后的 diff
 *
 * 算法说明：
 * 1. 过滤出内容行（以 +, -, 或空格开头）
 * 2. 排除文件头行（---, +++）
 * 3. 计算最小公共缩进
 * 4. 从所有内容行中移除最小公共缩进
 */
export function trimDiff(diff: string): string {
  const lines = diff.split("\n")

  // 过滤出内容行
  const contentLines = lines.filter(
    (line) =>
      (line.startsWith("+") || line.startsWith("-") || line.startsWith(" ")) &&
      !line.startsWith("---") &&
      !line.startsWith("+++"),
  )

  // 如果没有内容行，返回原始 diff
  if (contentLines.length === 0) return diff

  // 计算最小缩进
  let min = Infinity
  for (const line of contentLines) {
    const content = line.slice(1)
    if (content.trim().length > 0) {
      const match = content.match(/^(\s*)/)
      if (match) min = Math.min(min, match[1].length)
    }
  }

  // 如果没有缩进或最小缩进为 0，返回原始 diff
  if (min === Infinity || min === 0) return diff

  // 从所有内容行中移除最小缩进
  const trimmedLines = lines.map((line) => {
    if (
      (line.startsWith("+") || line.startsWith("-") || line.startsWith(" ")) &&
      !line.startsWith("---") &&
      !line.startsWith("+++")
    ) {
      const prefix = line[0]
      const content = line.slice(1)
      return prefix + content.slice(min)
    }
    return line
  })

  return trimmedLines.join("\n")
}

/**
 * 主替换函数
 *
 * 按顺序尝试所有替换策略，找到第一个成功匹配后执行替换。
 *
 * @param content - 原始内容
 * @param oldString - 要查找的字符串
 * @param newString - 替换后的字符串
 * @param replaceAll - 是否替换所有出现
 * @returns 替换后的内容
 *
 * 算法说明：
 * 1. 验证 oldString 和 newString 不同
 * 2. 按顺序尝试每种替换策略
 * 3. 对于每个策略，遍历所有生成的匹配
 * 4. 找到匹配后：
 *    - 如果 replaceAll 为 true，替换所有出现
 *    - 如果 replaceAll 为 false，确保只有一个匹配后替换
 * 5. 如果没有找到匹配，抛出错误
 * 6. 如果找到多个匹配且 replaceAll 为 false，抛出错误
 *
 * 替换策略顺序（从严格到宽松）：
 * 1. SimpleReplacer - 精确匹配
 * 2. LineTrimmedReplacer - 行修剪匹配
 * 3. BlockAnchorReplacer - 块锚点匹配
 * 4. WhitespaceNormalizedReplacer - 空白标准化匹配
 * 5. IndentationFlexibleReplacer - 缩进灵活匹配
 * 6. EscapeNormalizedReplacer - 转义标准化匹配
 * 7. TrimmedBoundaryReplacer - 边界修剪匹配
 * 8. ContextAwareReplacer - 上下文感知匹配
 * 9. MultiOccurrenceReplacer - 多出现匹配
 */
export function replace(content: string, oldString: string, newString: string, replaceAll = false): string {
  // 验证参数
  if (oldString === newString) {
    throw new Error("oldString and newString must be different")
  }

  let notFound = true

  // 按顺序尝试所有替换策略
  for (const replacer of [
    SimpleReplacer,
    LineTrimmedReplacer,
    BlockAnchorReplacer,
    WhitespaceNormalizedReplacer,
    IndentationFlexibleReplacer,
    EscapeNormalizedReplacer,
    TrimmedBoundaryReplacer,
    ContextAwareReplacer,
    MultiOccurrenceReplacer,
  ]) {
    // 遍历替换器生成的所有匹配
    for (const search of replacer(content, oldString)) {
      // 检查内容中是否包含匹配
      const index = content.indexOf(search)
      if (index === -1) continue

      // 找到匹配
      notFound = false

      // 如果是替换所有出现
      if (replaceAll) {
        return content.replaceAll(search, newString)
      }

      // 检查是否有多个匹配
      const lastIndex = content.lastIndexOf(search)
      if (index !== lastIndex) continue

      // 只有一个匹配，执行替换
      return content.substring(0, index) + newString + content.substring(index + search.length)
    }
  }

  // 没有找到匹配
  if (notFound) {
    throw new Error("oldString not found in content")
  }

  // 找到多个匹配但没有设置 replaceAll
  throw new Error(
    "Found multiple matches for oldString. Provide more surrounding lines in oldString to identify the correct match.",
  )
}
