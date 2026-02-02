/**
 * 文件用途: 路径工具模块
 * 作者: TRAE, 创建日期: 2026-02-02
 * 
 * 输入输出签名:
 * - normalizePathForComparison(path: string): string - 规范化路径用于比较
 * 
 * 依赖列表: 无
 * 
 * 与其他模块交互方式:
 * - 被 packages/app/src/context/server.tsx 导入使用
 * - 被 packages/app/src/pages/layout.tsx 导入使用
 * 
 * 其他备注: 
 * - 此模块提供路径规范化功能，用于解决Windows路径大小写不一致问题
 * - 与 packages/opencode/src/util/filesystem.ts 中的 normalizePath 不同，后者使用 realpathSync.native 获取文件系统真实路径
 */

/**
 * 规范化路径用于比较，避免在Windows上重复创建项目
 * 
 * @param path - 需要规范化的路径
 * @returns 规范化后的路径，格式为：正斜杠、无末尾斜杠、Windows上为小写
 * @throws {Error} 如果路径为空或无效
 * 
 * @example
 * // Windows
 * normalizePathForComparison('C:\\Users\\Project') // 'c:/users/project'
 * normalizePathForComparison('C:/Users/Project/') // 'c:/users/project'
 * 
 * @example
 * // macOS/Linux
 * normalizePathForComparison('/Users/Project') // '/Users/Project'
 * normalizePathForComparison('/Users/Project/') // '/Users/Project'
 */
export function normalizePathForComparison(path: string): string {
  // 输入验证
  if (!path || typeof path !== 'string') {
    throw new Error('Invalid path: path must be a non-empty string')
  }
  
  let normalized = path.trim()
  
  // 检查空路径
  if (normalized.length === 0) {
    throw new Error('Invalid path: path cannot be empty')
  }
  
  // 统一斜杠为正斜杠
  normalized = normalized.replace(/\\/g, '/')
  
  // 移除末尾斜杠
  normalized = normalized.replace(/\/$/, '')
  
  // 在Windows上，统一为小写以进行不区分大小写的比较
  if (process.platform === 'win32') {
    normalized = normalized.toLowerCase()
  }
  
  return normalized
}
