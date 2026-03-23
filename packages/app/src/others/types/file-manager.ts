/**
 * 文件管理相关类型定义
 */

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
 * 列出目录请求参数
 */
export interface ListFilesParams {
  path?: string
}

/**
 * 列出目录响应
 */
export interface ListFilesResponse {
  success: true
  files: FileNode[]
}

/**
 * 读取文件请求参数
 */
export interface ReadFileParams {
  path: string
}

/**
 * 读取文件响应
 */
export interface ReadFileResponse {
  success: true
  content: string
}

/**
 * 写入文件请求参数
 */
export interface WriteFileParams {
  path: string
  content: string
}

/**
 * 写入文件响应
 */
export interface WriteFileResponse {
  success: true
}

/**
 * 创建文件/目录请求参数
 */
export interface CreateItemParams {
  path: string
  type: "file" | "directory"
}

/**
 * 创建响应
 */
export interface CreateItemResponse {
  success: true
  path: string
}

/**
 * 删除请求参数
 */
export interface DeleteItemParams {
  path: string
}

/**
 * 删除响应
 */
export interface DeleteItemResponse {
  success: true
}

/**
 * 移动请求参数
 */
export interface MoveItemParams {
  oldPath: string
  newPath: string
}

/**
 * 移动响应
 */
export interface MoveItemResponse {
  success: true
}

/**
 * 上传文件响应
 */
export interface UploadFileResponse {
  success: true
  path: string
}

/**
 * API 错误响应
 */
export interface ApiErrorResponse {
  success: false
  message: string
}
