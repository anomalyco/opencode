/**
 * 文件管理 Hook
 * 封装文件操作 API 调用
 */

import { useAuth } from "../context/auth"
import type {
  FileNode,
  ListFilesParams,
  ListFilesResponse,
  ReadFileParams,
  ReadFileResponse,
  WriteFileParams,
  WriteFileResponse,
  CreateItemParams,
  CreateItemResponse,
  DeleteItemParams,
  DeleteItemResponse,
  MoveItemParams,
  MoveItemResponse,
  UploadFileResponse,
  ApiErrorResponse,
} from "../types/file-manager"

export interface FileManagerReturn {
  listFiles: (params: ListFilesParams) => Promise<ListFilesResponse | ApiErrorResponse>
  readFile: (params: ReadFileParams) => Promise<ReadFileResponse | ApiErrorResponse>
  writeFile: (params: WriteFileParams) => Promise<WriteFileResponse | ApiErrorResponse>
  createFile: (path: string) => Promise<CreateItemResponse | ApiErrorResponse>
  createDirectory: (path: string) => Promise<CreateItemResponse | ApiErrorResponse>
  deleteFile: (path: string) => Promise<DeleteItemResponse | ApiErrorResponse>
  moveFile: (oldPath: string, newPath: string) => Promise<MoveItemResponse | ApiErrorResponse>
  uploadFile: (path: string, file: File) => Promise<UploadFileResponse | ApiErrorResponse>
  downloadFile: (path: string) => Promise<void>
}

/**
 * 文件管理 Hook
 */
export function useFileManager(serverUrl: string): FileManagerReturn {
  const auth = useAuth()

  /**
   * 创建带认证的 fetch 请求
   */
  async function authFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const headers = new Headers(init?.headers)

    // 添加认证 header
    const authHeaders = auth.getAuthHeaders()
    for (const [key, value] of Object.entries(authHeaders)) {
      headers.set(key, value)
    }

    return fetch(input, {
      ...init,
      headers,
    })
  }

  /**
   * 列出目录内容
   */
  async function listFiles(params: ListFilesParams): Promise<ListFilesResponse | ApiErrorResponse> {
    const query = new URLSearchParams()
    if (params.path) {
      query.append("path", params.path)
    }

    const response = await authFetch(`${serverUrl}/others/files/list?${query.toString()}`)

    if (!response.ok) {
      const error = await response.json().catch(() => ({ message: "Request failed" }))
      return { success: false, message: error.message || "Failed to list files" }
    }

    return response.json()
  }

  /**
   * 读取文件内容
   */
  async function readFile(params: ReadFileParams): Promise<ReadFileResponse | ApiErrorResponse> {
    const query = new URLSearchParams({ path: params.path })
    const response = await authFetch(`${serverUrl}/others/files/read?${query.toString()}`)

    if (!response.ok) {
      const error = await response.json().catch(() => ({ message: "Request failed" }))
      return { success: false, message: error.message || "Failed to read file" }
    }

    return response.json()
  }

  /**
   * 写入文件内容
   */
  async function writeFile(params: WriteFileParams): Promise<WriteFileResponse | ApiErrorResponse> {
    const response = await authFetch(`${serverUrl}/others/files/write`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(params),
    })

    if (!response.ok) {
      const error = await response.json().catch(() => ({ message: "Request failed" }))
      return { success: false, message: error.message || "Failed to write file" }
    }

    return response.json()
  }

  /**
   * 创建文件或目录
   */
  async function createFile(path: string): Promise<CreateItemResponse | ApiErrorResponse>
  async function createDirectory(path: string): Promise<CreateItemResponse | ApiErrorResponse>
  async function createItem(
    params: CreateItemParams,
  ): Promise<CreateItemResponse | ApiErrorResponse> {
    const response = await authFetch(`${serverUrl}/others/files/create`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(params),
    })

    if (!response.ok) {
      const error = await response.json().catch(() => ({ message: "Request failed" }))
      return { success: false, message: error.message || "Failed to create" }
    }

    return response.json()
  }

  /**
   * 创建文件
   */
  async function createFile(path: string): Promise<CreateItemResponse | ApiErrorResponse> {
    return createItem({ path, type: "file" })
  }

  /**
   * 创建目录
   */
  async function createDirectory(path: string): Promise<CreateItemResponse | ApiErrorResponse> {
    return createItem({ path, type: "directory" })
  }

  /**
   * 删除文件或目录
   */
  async function deleteFile(path: string): Promise<DeleteItemResponse | ApiErrorResponse> {
    const response = await authFetch(`${serverUrl}/others/files/delete`, {
      method: "DELETE",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ path }),
    })

    if (!response.ok) {
      const error = await response.json().catch(() => ({ message: "Request failed" }))
      return { success: false, message: error.message || "Failed to delete" }
    }

    return response.json()
  }

  /**
   * 移动文件或目录
   */
  async function moveFile(oldPath: string, newPath: string): Promise<MoveItemResponse | ApiErrorResponse> {
    const response = await authFetch(`${serverUrl}/others/files/move`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ oldPath, newPath }),
    })

    if (!response.ok) {
      const error = await response.json().catch(() => ({ message: "Request failed" }))
      return { success: false, message: error.message || "Failed to move" }
    }

    return response.json()
  }

  /**
   * 上传文件
   */
  async function uploadFile(path: string, file: File): Promise<UploadFileResponse | ApiErrorResponse> {
    const formData = new FormData()
    formData.append("file", file)
    if (path) {
      formData.append("path", path)
    }

    const response = await authFetch(`${serverUrl}/others/files/upload`, {
      method: "POST",
      body: formData,
    })

    if (!response.ok) {
      const error = await response.json().catch(() => ({ message: "Request failed" }))
      return { success: false, message: error.message || "Failed to upload" }
    }

    return response.json()
  }

  /**
   * 下载文件
   */
  async function downloadFile(path: string): Promise<void> {
    // 先读取文件内容
    const result = await readFile({ path })
    if (!result.success) {
      throw new Error(result.message)
    }

    // 创建 Blob 并触发下载
    const blob = new Blob([result.content], { type: "text/plain" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = path.split("/").pop() || "file"
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  return {
    listFiles,
    readFile,
    writeFile,
    createFile,
    createDirectory,
    deleteFile,
    moveFile,
    uploadFile,
    downloadFile,
  }
}
