/**
 * 文件管理服务
 * 提供文件和目录的增删改查操作，包含路径安全校验
 */

import path from "path"
import { promises as fs } from "fs"

/**
 * 文件节点信息
 */
export interface FileNode {
  name: string
  path: string
  type: "file" | "directory"
  size?: number
  modified?: number
  children?: FileNode[]
}

/**
 * 校验目标路径是否在 space_path 范围内
 * 防止路径遍历攻击
 * @param spacePath 用户的工作空间根路径
 * @param targetPath 要操作的目标路径
 * @returns 是否在允许的范围内
 */
export function validatePath(spacePath: string, targetPath: string): boolean {
  const resolvedSpace = path.resolve(spacePath)
  const resolvedTarget = path.resolve(targetPath)
  const relative = path.relative(resolvedSpace, resolvedTarget)
  // 不允许 .. 路径跳出 space_path
  return !relative.startsWith("..") && !path.isAbsolute(relative)
}

/**
 * 列出目录内容
 * @param spacePath 用户的工作空间根路径
 * @param dirPath 要列出的目录路径（相对于 spacePath 或绝对路径）
 * @returns 文件节点列表
 */
export async function listFiles(spacePath: string, dirPath: string): Promise<FileNode[]> {
  const resolvedDir = path.isAbsolute(dirPath) ? dirPath : path.resolve(spacePath, dirPath)

  if (!validatePath(spacePath, resolvedDir)) {
    throw new Error("Access denied: path outside workspace")
  }

  try {
    const entries = await fs.readdir(resolvedDir, { withFileTypes: true })
    const nodes: FileNode[] = []

    for (const entry of entries) {
      const fullPath = path.join(resolvedDir, entry.name)
      let stats: import("fs").Stats

      try {
        stats = await fs.stat(fullPath)
      } catch {
        // 如果无法获取 stat，跳过此条目
        continue
      }

      const node: FileNode = {
        name: entry.name,
        path: fullPath,
        type: entry.isDirectory() ? "directory" : "file",
        size: entry.isFile() ? stats.size : undefined,
        modified: stats.mtimeMs,
      }

      nodes.push(node)
    }

    // 排序：目录在前，文件在后，同类型按名称排序
    nodes.sort((a, b) => {
      if (a.type !== b.type) {
        return a.type === "directory" ? -1 : 1
      }
      return a.name.localeCompare(b.name)
    })

    return nodes
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error("Directory not found")
    }
    if ((error as NodeJS.ErrnoException).code === "EACCES") {
      throw new Error("Permission denied")
    }
    throw error
  }
}

/**
 * 读取文件内容
 * @param spacePath 用户的工作空间根路径
 * @param filePath 文件路径
 * @returns 文件内容（文本）
 */
export async function readFile(spacePath: string, filePath: string): Promise<string> {
  const resolvedFile = path.isAbsolute(filePath) ? filePath : path.resolve(spacePath, filePath)

  if (!validatePath(spacePath, resolvedFile)) {
    throw new Error("Access denied: path outside workspace")
  }

  try {
    return await fs.readFile(resolvedFile, "utf-8")
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error("File not found")
    }
    if ((error as NodeJS.ErrnoException).code === "EACCES") {
      throw new Error("Permission denied")
    }
    if ((error as NodeJS.ErrnoException).code === "EISDIR") {
      throw new Error("Cannot read directory as file")
    }
    throw error
  }
}

/**
 * 写入文件内容
 * @param spacePath 用户的工作空间根路径
 * @param filePath 文件路径
 * @param content 文件内容
 */
export async function writeFile(spacePath: string, filePath: string, content: string): Promise<void> {
  const resolvedFile = path.isAbsolute(filePath) ? filePath : path.resolve(spacePath, filePath)

  if (!validatePath(spacePath, resolvedFile)) {
    throw new Error("Access denied: path outside workspace")
  }

  // 确保父目录存在
  const dir = path.dirname(resolvedFile)
  await fs.mkdir(dir, { recursive: true })

  await fs.writeFile(resolvedFile, content, "utf-8")
}

/**
 * 创建文件
 * @param spacePath 用户的工作空间根路径
 * @param filePath 文件路径
 */
export async function createFile(spacePath: string, filePath: string): Promise<void> {
  const resolvedFile = path.isAbsolute(filePath) ? filePath : path.resolve(spacePath, filePath)

  if (!validatePath(spacePath, resolvedFile)) {
    throw new Error("Access denied: path outside workspace")
  }

  // 确保父目录存在
  const dir = path.dirname(resolvedFile)
  await fs.mkdir(dir, { recursive: true })

  // 创建空文件
  await fs.writeFile(resolvedFile, "", "utf-8")
}

/**
 * 创建目录
 * @param spacePath 用户的工作空间根路径
 * @param dirPath 目录路径
 */
export async function createDirectory(spacePath: string, dirPath: string): Promise<void> {
  const resolvedDir = path.isAbsolute(dirPath) ? dirPath : path.resolve(spacePath, dirPath)

  if (!validatePath(spacePath, resolvedDir)) {
    throw new Error("Access denied: path outside workspace")
  }

  await fs.mkdir(resolvedDir, { recursive: true })
}

/**
 * 删除文件或目录
 * @param spacePath 用户的工作空间根路径
 * @param targetPath 文件或目录路径
 */
export async function deleteFile(spacePath: string, targetPath: string): Promise<void> {
  const resolvedPath = path.isAbsolute(targetPath) ? targetPath : path.resolve(spacePath, targetPath)

  if (!validatePath(spacePath, resolvedPath)) {
    throw new Error("Access denied: path outside workspace")
  }

  try {
    const stats = await fs.stat(resolvedPath)
    if (stats.isDirectory()) {
      await fs.rm(resolvedPath, { recursive: true, force: true })
    } else {
      await fs.unlink(resolvedPath)
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      // 文件不存在，视为成功
      return
    }
    throw error
  }
}

/**
 * 移动文件或目录
 * @param spacePath 用户的工作空间根路径
 * @param oldPath 原路径
 * @param newPath 新路径
 */
export async function moveFile(spacePath: string, oldPath: string, newPath: string): Promise<void> {
  const resolvedOld = path.isAbsolute(oldPath) ? oldPath : path.resolve(spacePath, oldPath)
  const resolvedNew = path.isAbsolute(newPath) ? newPath : path.resolve(spacePath, newPath)

  if (!validatePath(spacePath, resolvedOld)) {
    throw new Error("Access denied: source path outside workspace")
  }

  if (!validatePath(spacePath, resolvedNew)) {
    throw new Error("Access denied: destination path outside workspace")
  }

  // 确保目标目录存在
  const newDir = path.dirname(resolvedNew)
  await fs.mkdir(newDir, { recursive: true })

  await fs.rename(resolvedOld, resolvedNew)
}

/**
 * 上传文件（保存上传的文件到指定位置）
 * @param spacePath 用户的工作空间根路径
 * @param targetPath 目标文件路径
 * @param content 文件内容（Buffer 或 Uint8Array）
 */
export async function uploadFile(spacePath: string, targetPath: string, content: Buffer | Uint8Array): Promise<void> {
  const resolvedFile = path.isAbsolute(targetPath) ? targetPath : path.resolve(spacePath, targetPath)

  if (!validatePath(spacePath, resolvedFile)) {
    throw new Error("Access denied: path outside workspace")
  }

  // 确保父目录存在
  const dir = path.dirname(resolvedFile)
  await fs.mkdir(dir, { recursive: true })

  await fs.writeFile(resolvedFile, content)
}

/**
 * 读取文件为 Buffer（用于下载二进制文件）
 * @param spacePath 用户的工作空间根路径
 * @param filePath 文件路径
 * @returns 文件内容（Buffer）
 */
export async function readFileBuffer(spacePath: string, filePath: string): Promise<Buffer> {
  const resolvedFile = path.isAbsolute(filePath) ? filePath : path.resolve(spacePath, filePath)

  if (!validatePath(spacePath, resolvedFile)) {
    throw new Error("Access denied: path outside workspace")
  }

  try {
    return await fs.readFile(resolvedFile)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error("File not found")
    }
    if ((error as NodeJS.ErrnoException).code === "EACCES") {
      throw new Error("Permission denied")
    }
    if ((error as NodeJS.ErrnoException).code === "EISDIR") {
      throw new Error("Cannot read directory as file")
    }
    throw error
  }
}
