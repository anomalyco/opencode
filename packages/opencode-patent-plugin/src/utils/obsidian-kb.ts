/**
 * Obsidian 知识库工具
 *
 * 读取和搜索本地 Obsidian 知识库：
 * /Users/xujian/Library/Mobile Documents/iCloud~md~obsidian/Documents/宝宸知识库
 *
 * 包含 2108+ Markdown 文件，涵盖：
 * - 法律法规（专利法、实施细则、审查指南）
 * - 复审无效决定
 * - 专利判决
 * - 实务笔记
 * - 专业书籍骨架
 */

import { existsSync } from "fs"
import { readFile, readdir, stat } from "fs/promises"
import { resolve, join, relative, extname } from "path"
import { quickSearch } from "./obsidian-index.js"

const KNOWLEDGE_BASE_PATH =
  process.env.OBSIDIAN_KB_PATH ||
  "/Users/xujian/Library/Mobile Documents/iCloud~md~obsidian/Documents/宝宸知识库"

/**
 * Markdown 文件信息
 */
export interface MarkdownFile {
  path: string
  relativePath: string
  title: string
  folder: string
  size: number
  modifiedTime: Date
}

/**
 * 搜索结果
 */
export interface SearchResult {
  file: MarkdownFile
  matches: Array<{
    lineNumber: number
    lineText: string
    context: string
  }>
  relevance: number
}

/**
 * 扫描所有 Markdown 文件
 */
export async function scanMarkdownFiles(
  subPath: string = "",
): Promise<MarkdownFile[]> {
  const basePath = join(KNOWLEDGE_BASE_PATH, subPath)
  if (!existsSync(basePath)) return []

  const files: MarkdownFile[] = []

  async function scan(dir: string) {
    const entries = await readdir(dir, { withFileTypes: true })
    for (const entry of entries) {
      const fullPath = join(dir, entry.name)
      if (entry.isDirectory() && !entry.name.startsWith(".") && entry.name !== "node_modules") {
        await scan(fullPath)
      } else if (entry.isFile() && extname(entry.name) === ".md") {
        const stats = await stat(fullPath)
        const relPath = relative(KNOWLEDGE_BASE_PATH, fullPath)
        files.push({
          path: fullPath,
          relativePath: relPath,
          title: entry.name.replace(/\.md$/, ""),
          folder: relative(KNOWLEDGE_BASE_PATH, dir),
          size: stats.size,
          modifiedTime: stats.mtime,
        })
      }
    }
  }

  await scan(basePath)
  return files
}

/**
 * 读取 Markdown 文件内容
 */
export async function readMarkdownFile(filePath: string): Promise<string> {
  const fullPath = filePath.startsWith("/") ? filePath : join(KNOWLEDGE_BASE_PATH, filePath)
  if (!existsSync(fullPath)) throw new Error(`File not found: ${fullPath}`)
  return readFile(fullPath, "utf-8")
}

/**
 * 全文搜索知识库
 *
 * 优先使用 SQLite FTS5 索引（如果存在），否则回退到全量扫描。
 */
export async function searchKnowledgeBase(
  query: string,
  options: {
    limit?: number
    folders?: string[]
    caseSensitive?: boolean
  } = {},
): Promise<SearchResult[]> {
  const { limit = 10, folders } = options

  // 优先使用 SQLite 索引（无 folders 过滤时）
  if (!folders || folders.length === 0) {
    try {
      const indexResults = await quickSearch(query, limit)
      if (indexResults.length > 0) {
        return indexResults.map(r => ({
          file: {
            path: r.filePath,
            relativePath: r.filePath,
            title: r.fileTitle,
            folder: r.folder,
            size: 0,
            modifiedTime: new Date(),
          },
          matches: [{
            lineNumber: 1,
            lineText: r.heading || r.content.slice(0, 100),
            context: r.content,
          }],
          relevance: Math.abs(r.rank) || 1,
        }))
      }
    } catch (error: any) {
      console.warn("[ObsidianIndex] Search failed, falling back to scan:", error?.message)
    }
  }

  // 回退：全量扫描（带 folders 过滤或索引失败时）
  const allFiles = await scanMarkdownFiles()
  let targetFiles = allFiles

  if (folders && folders.length > 0) {
    targetFiles = allFiles.filter(f => folders.some(folder => f.folder.includes(folder)))
  }

  const results: SearchResult[] = []
  const searchTerm = query.toLowerCase()

  for (const file of targetFiles) {
    try {
      const content = await readMarkdownFile(file.path)
      const lines = content.split("\n")
      const matches: SearchResult["matches"] = []

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]
        if (line.toLowerCase().includes(searchTerm)) {
          const contextStart = Math.max(0, i - 1)
          const contextEnd = Math.min(lines.length, i + 2)
          matches.push({
            lineNumber: i + 1,
            lineText: line.trim(),
            context: lines.slice(contextStart, contextEnd).join("\n"),
          })
        }
      }

      if (matches.length > 0) {
        const titleMatch = file.title.toLowerCase().includes(searchTerm) ? 10 : 0
        results.push({
          file,
          matches,
          relevance: titleMatch + matches.length,
        })
      }
    } catch {
      // 忽略读取失败的文件
    }
  }

  results.sort((a, b) => b.relevance - a.relevance)
  return results.slice(0, limit)
}

/**
 * 按文件夹搜索
 */
export async function searchByFolder(
  folder: string,
  query?: string,
  limit: number = 10,
): Promise<SearchResult[]> {
  const files = await scanMarkdownFiles(folder)
  if (!query) {
    // 只返回文件列表，不搜索内容
    return files.slice(0, limit).map(file => ({
      file,
      matches: [],
      relevance: 0,
    }))
  }
  return searchKnowledgeBase(query, { limit, folders: [folder] })
}

/**
 * 获取知识库统计
 */
export async function getKnowledgeBaseStats(): Promise<{
  totalFiles: number
  totalSize: number
  folders: string[]
}> {
  const files = await scanMarkdownFiles()
  const folders = [...new Set(files.map(f => f.folder.split("/")[0]))]
  const totalSize = files.reduce((sum, f) => sum + f.size, 0)
  return {
    totalFiles: files.length,
    totalSize,
    folders,
  }
}

/**
 * 快速法规查询
 */
export async function queryLawFromKB(
  lawName: string,
  articleNumber?: string,
): Promise<string> {
  const folders = ["Wiki/法律法规", "Raw/法律法规司法解释", "Raw/法律法规司法解释_md", "Wiki/审查指南"]

  const results = await searchKnowledgeBase(lawName, { limit: 20, folders })

  if (articleNumber) {
    // 尝试精确定位条款
    const exactMatch = results.find(r =>
      r.matches.some(m => m.lineText.includes(articleNumber)),
    )
    if (exactMatch) {
      const content = await readMarkdownFile(exactMatch.file.path)
      // 提取条款附近的内容
      const lines = content.split("\n")
      const matchIdx = lines.findIndex(l => l.includes(articleNumber))
      if (matchIdx >= 0) {
        const start = Math.max(0, matchIdx - 3)
        const end = Math.min(lines.length, matchIdx + 10)
        return lines.slice(start, end).join("\n")
      }
    }
  }

  // 返回最相关文件的内容摘要
  if (results.length > 0) {
    const topResult = results[0]
    const content = await readMarkdownFile(topResult.file.path)
    // 返回前 3000 字符作为摘要
    return content.slice(0, 3000) + (content.length > 3000 ? "\n\n..." : "")
  }

  return `未在知识库中找到 "${lawName}" 的相关内容。`
}

/**
 * 查询审查指南
 */
export async function queryGuidelinesFromKB(
  topic: string,
): Promise<string> {
  const folders = ["Wiki/审查指南", "Raw/审查指南", "Raw/审查指南_md"]
  const results = await searchKnowledgeBase(topic, { limit: 10, folders })

  if (results.length === 0) {
    return `未在审查指南中找到 "${topic}" 的相关内容。`
  }

  let output = `## 审查指南相关查询：${topic}\n\n`
  for (const result of results.slice(0, 3)) {
    const content = await readMarkdownFile(result.file.path)
    output += `### ${result.file.title}\n\n`
    // 提取匹配上下文
    for (const match of result.matches.slice(0, 3)) {
      output += `${match.context}\n\n---\n\n`
    }
  }
  return output
}

/**
 * 查询复审无效决定
 */
export async function queryInvalidationFromKB(
  keyword: string,
): Promise<string> {
  const folders = ["Wiki/复审无效", "Raw/无效复审决定"]
  const results = await searchKnowledgeBase(keyword, { limit: 10, folders })

  if (results.length === 0) {
    return `未在复审无效决定中找到 "${keyword}" 的相关内容。`
  }

  let output = `## 复审无效相关查询：${keyword}\n\n`
  for (const result of results.slice(0, 5)) {
    output += `### ${result.file.title}\n`
    for (const match of result.matches.slice(0, 2)) {
      output += `${match.lineText}\n`
    }
    output += "\n"
  }
  return output
}

/**
 * 查询专利判决
 */
export async function queryJudgmentFromKB(
  keyword: string,
): Promise<string> {
  const folders = ["Wiki/专利判决", "Raw/专利判决", "Raw/指导性专利判决文书", "Raw/指导性专利判决文书_md"]
  const results = await searchKnowledgeBase(keyword, { limit: 10, folders })

  if (results.length === 0) {
    return `未在专利判决中找到 "${keyword}" 的相关内容。`
  }

  let output = `## 专利判决相关查询：${keyword}\n\n`
  for (const result of results.slice(0, 5)) {
    output += `### ${result.file.title}\n`
    for (const match of result.matches.slice(0, 2)) {
      output += `${match.lineText}\n`
    }
    output += "\n"
  }
  return output
}
