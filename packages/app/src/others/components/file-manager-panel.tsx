/**
 * 文件管理面板组件
 * 管理 space_path 下的文件和文件夹
 */

import { createSignal, For, Show, onMount, createEffect } from "solid-js"
import { Dialog } from "@opencode-ai/ui/dialog"
import { Button } from "@opencode-ai/ui/button"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { TextField } from "@opencode-ai/ui/text-field"
import { DropdownMenu } from "@opencode-ai/ui/dropdown-menu"
import { useServer } from "@/context/server"
import { useAuth } from "../context/auth"
import { showToast } from "@opencode-ai/ui/toast"

/**
 * 浏览器兼容的路径工具函数
 */
const pathUtils = {
  dirname: (p: string): string => {
    const parts = p.replace(/\\/g, "/").split("/")
    parts.pop()
    return parts.join("/") || "/"
  },
  extname: (p: string): string => {
    const parts = p.replace(/\\/g, "/").split("/")
    const filename = parts[parts.length - 1] || ""
    const dotIndex = filename.lastIndexOf(".")
    return dotIndex > 0 ? filename.slice(dotIndex) : ""
  },
}

interface FileManagerPanelProps {
  initialPath?: string
}

interface FileNode {
  name: string
  path: string
  type: "file" | "directory"
  size?: number
  modified?: number
}

/**
 * 文件管理面板
 */
export function FileManagerPanel(props: FileManagerPanelProps) {
  const server = useServer()
  const auth = useAuth()

  const [currentPath, setCurrentPath] = createSignal("")
  const [files, setFiles] = createSignal<FileNode[]>([])
  const [loading, setLoading] = createSignal(false)

  // 子对话框状态
  const [createDialogType, setCreateDialogType] = createSignal<"file" | "directory" | null>(null)
  const [renameDialogFile, setRenameDialogFile] = createSignal<FileNode | null>(null)
  const [editDialogFile, setEditDialogFile] = createSignal<FileNode | null>(null)
  const [moveDialogFile, setMoveDialogFile] = createSignal<FileNode | null>(null)

  // 子对话框内部状态
  const [subDialogLoading, setSubDialogLoading] = createSignal(false)
  const [createName, setCreateName] = createSignal("")
  const [renameName, setRenameName] = createSignal("")
  const [editContent, setEditContent] = createSignal("")
  const [editLoading, setEditLoading] = createSignal(false)
  const [moveTargetPath, setMoveTargetPath] = createSignal("")
  const [moveLoading, setMoveLoading] = createSignal(false)

  // 编辑对话框大小状态
  const [editMaximized, setEditMaximized] = createSignal(false)
  const [editSize, setEditSize] = createSignal({ width: 700, height: 500 })
  const [editPosition, setEditPosition] = createSignal({ x: 0, y: 0 })

  // 移动对话框的目录浏览器状态
  const [moveBrowserPath, setMoveBrowserPath] = createSignal("")
  const [moveBrowserDirs, setMoveBrowserDirs] = createSignal<FileNode[]>([])
  const [moveBrowserLoading, setMoveBrowserLoading] = createSignal(false)

  // 获取 space_path
  const spacePath = () => auth.user?.space_path || ""

  // API 请求辅助函数
  const apiRequest = async (
    endpoint: string,
    options?: RequestInit,
  ): Promise<{ success: boolean; data?: any; message?: string }> => {
    const currentServer = server.current
    if (!currentServer) {
      return { success: false, message: "服务器未连接" }
    }

    const headers: Record<string, string> = {
      ...(options?.headers as Record<string, string> || {}),
      "Content-Type": "application/json",
    }

    if (auth.token) {
      headers["Authorization"] = `Bearer ${auth.token}`
    }

    try {
      const response = await fetch(`${currentServer.http.url}/others/files${endpoint}`, {
        ...options,
        headers,
      })

      const data = await response.json()
      return { success: data.success, data, message: data.message }
    } catch (e) {
      return { success: false, message: "网络错误" }
    }
  }

  // 加载文件列表
  const loadFiles = async () => {
    const path = currentPath() || spacePath()
    if (!path) return

    setLoading(true)
    try {
      const query = path === spacePath() ? "" : `?path=${encodeURIComponent(path)}`
      const result = await apiRequest(`/list${query}`, { method: "GET" })

      if (result.success && result.data?.files) {
        setFiles(result.data.files)
      } else {
        showToast({ variant: "error", title: "加载失败", description: result.message })
      }
    } finally {
      setLoading(false)
    }
  }

  onMount(() => {
    const sp = spacePath()
    if (sp) {
      setCurrentPath(sp)
    }
  })

  // 当路径变化时重新加载
  createEffect(() => {
    const path = currentPath()
    if (path) {
      loadFiles()
    }
  })

  // 进入目录
  const enterDirectory = (file: FileNode) => {
    if (file.type === "directory") {
      setCurrentPath(file.path)
    }
  }

  // 返回上级目录
  const goUp = () => {
    const parent = pathUtils.dirname(currentPath())
    if (parent && parent !== currentPath()) {
      setCurrentPath(parent)
    }
  }

  // 能否返回上级
  const canGoUp = () => {
    const path = currentPath()
    return path && path !== spacePath()
  }

  // 获取面包屑
  const getBreadcrumbs = () => {
    const path = currentPath()
    const sp = spacePath()
    if (!path || !sp) return []

    const relativePath = path.startsWith(sp) ? path.slice(sp.length).replace(/^\//, "") : path
    const parts = relativePath.split("/").filter(Boolean)

    const breadcrumbs: { name: string; path: string }[] = [{ name: "根目录", path: sp }]
    let accum = sp

    for (const part of parts) {
      accum += "/" + part
      breadcrumbs.push({ name: part, path: accum })
    }

    return breadcrumbs
  }

  // 关闭子对话框
  const closeSubDialog = () => {
    setCreateDialogType(null)
    setRenameDialogFile(null)
    setEditDialogFile(null)
    setMoveDialogFile(null)
    setCreateName("")
    setRenameName("")
    setEditContent("")
    setMoveTargetPath("")
    setSubDialogLoading(false)
    setEditLoading(false)
    setMoveLoading(false)
    setMoveBrowserPath("")
    setMoveBrowserDirs([])
    setMoveBrowserLoading(false)
    // 重置编辑对话框状态
    setEditMaximized(false)
    setEditSize({ width: 700, height: 500 })
    setEditPosition({ x: 0, y: 0 })
  }

  // 创建文件/文件夹
  const handleCreate = async () => {
    const name = createName().trim()
    if (!name) {
      showToast({ variant: "error", title: "错误", description: "名称不能为空" })
      return
    }

    const type = createDialogType()
    if (!type) return

    setSubDialogLoading(true)
    const newPath = `${currentPath()}/${name}`
    const result = await apiRequest("/create", {
      method: "POST",
      body: JSON.stringify({ path: newPath, type }),
    })
    setSubDialogLoading(false)

    if (result.success) {
      showToast({ variant: "success", title: "创建成功" })
      closeSubDialog()
      loadFiles()
    } else {
      showToast({ variant: "error", title: "创建失败", description: result.message })
    }
  }

  // 重命名
  const handleRename = async () => {
    const file = renameDialogFile()
    if (!file) return

    const newName = renameName().trim()
    if (!newName) return

    setSubDialogLoading(true)
    const newPath = pathUtils.dirname(file.path) + "/" + newName
    const result = await apiRequest("/move", {
      method: "POST",
      body: JSON.stringify({ oldPath: file.path, newPath }),
    })
    setSubDialogLoading(false)

    if (result.success) {
      showToast({ variant: "success", title: "重命名成功" })
      closeSubDialog()
      loadFiles()
    } else {
      showToast({ variant: "error", title: "重命名失败", description: result.message })
    }
  }

  // 加载编辑文件内容
  const loadEditContent = async () => {
    const file = editDialogFile()
    if (!file) return

    setEditLoading(true)
    const result = await apiRequest(`/read?path=${encodeURIComponent(file.path)}`, { method: "GET" })
    setEditLoading(false)

    if (result.success && result.data?.content) {
      setEditContent(result.data.content)
    } else {
      showToast({ variant: "error", title: "读取失败", description: result.message })
      closeSubDialog()
    }
  }

  // 当编辑对话框打开时加载内容
  createEffect(() => {
    if (editDialogFile()) {
      loadEditContent()
    }
  })

  // 保存编辑
  const handleSaveEdit = async () => {
    const file = editDialogFile()
    if (!file) return

    setSubDialogLoading(true)
    const result = await apiRequest("/write", {
      method: "POST",
      body: JSON.stringify({ path: file.path, content: editContent() }),
    })
    setSubDialogLoading(false)

    if (result.success) {
      showToast({ variant: "success", title: "保存成功" })
      closeSubDialog()
      loadFiles()
    } else {
      showToast({ variant: "error", title: "保存失败", description: result.message })
    }
  }

  // 加载移动对话框的目录列表
  const loadMoveBrowserDirs = async (path: string) => {
    setMoveBrowserLoading(true)
    try {
      const query = path === spacePath() ? "" : `?path=${encodeURIComponent(path)}`
      const result = await apiRequest(`/list${query}`, { method: "GET" })

      if (result.success && result.data?.files) {
        // 只显示目录
        const dirs = result.data.files.filter((f: FileNode) => f.type === "directory")
        setMoveBrowserDirs(dirs)
        setMoveBrowserPath(path)
      } else {
        showToast({ variant: "error", title: "加载目录失败", description: result.message })
      }
    } finally {
      setMoveBrowserLoading(false)
    }
  }

  // 当移动对话框打开时，初始化目录浏览器
  createEffect(() => {
    if (moveDialogFile()) {
      const initialPath = currentPath()
      setMoveTargetPath(initialPath)
      loadMoveBrowserDirs(initialPath)
    }
  })

  // 移动对话框中进入子目录
  const moveBrowserEnterDir = (dir: FileNode) => {
    const newPath = dir.path
    setMoveTargetPath(newPath)
    loadMoveBrowserDirs(newPath)
  }

  // 移动对话框中返回上级目录
  const moveBrowserGoUp = () => {
    const currentBrowserPath = moveBrowserPath()
    const sp = spacePath()
    if (currentBrowserPath && currentBrowserPath !== sp) {
      const parent = pathUtils.dirname(currentBrowserPath)
      setMoveTargetPath(parent)
      loadMoveBrowserDirs(parent)
    }
  }

  // 移动文件/文件夹
  const handleMove = async () => {
    const file = moveDialogFile()
    if (!file) return

    const targetPath = moveTargetPath().trim()
    if (!targetPath) {
      showToast({ variant: "error", title: "错误", description: "目标路径不能为空" })
      return
    }

    // 构建完整的目标路径（文件名保持不变）
    const newPath = `${targetPath}/${file.name}`

    setMoveLoading(true)
    const result = await apiRequest("/move", {
      method: "POST",
      body: JSON.stringify({ oldPath: file.path, newPath }),
    })
    setMoveLoading(false)

    if (result.success) {
      showToast({ variant: "success", title: "移动成功" })
      closeSubDialog()
      loadFiles()
    } else {
      showToast({ variant: "error", title: "移动失败", description: result.message })
    }
  }

  // 删除文件
  const handleDelete = async (file: FileNode) => {
    const result = await apiRequest("/delete", {
      method: "DELETE",
      body: JSON.stringify({ path: file.path }),
    })
    if (result.success) {
      showToast({ variant: "success", title: "删除成功" })
      loadFiles()
    } else {
      showToast({ variant: "error", title: "删除失败", description: result.message })
    }
  }

  // 上传文件
  const handleUpload = () => {
    const input = document.createElement("input")
    input.type = "file"
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0]
      if (!file) return

      const currentServer = server.current
      if (!currentServer) return

      const formData = new FormData()
      formData.append("file", file)
      formData.append("path", currentPath())

      const headers = new Headers()
      if (auth.token) {
        headers.set("Authorization", `Bearer ${auth.token}`)
      }

      try {
        const response = await fetch(`${currentServer.http.url}/others/files/upload`, {
          method: "POST",
          headers,
          body: formData,
        })
        const result = await response.json()

        if (result.success) {
          showToast({ variant: "success", title: "上传成功" })
          loadFiles()
        } else {
          showToast({ variant: "error", title: "上传失败", description: result.message })
        }
      } catch (e) {
        showToast({ variant: "error", title: "上传失败", description: "网络错误" })
      }
    }
    input.click()
  }

  // 下载文件
  const handleDownload = async (file: FileNode) => {
    const currentServer = server.current
    if (!currentServer) {
      showToast({ variant: "error", title: "下载失败", description: "服务器未连接" })
      return
    }

    try {
      const headers = new Headers()
      if (auth.token) {
        headers.set("Authorization", `Bearer ${auth.token}`)
      }

      const response = await fetch(
        `${currentServer.http.url}/others/files/download?path=${encodeURIComponent(file.path)}`,
        { headers },
      )

      if (!response.ok) {
        const error = await response.json().catch(() => ({ message: "下载失败" }))
        showToast({ variant: "error", title: "下载失败", description: error.message })
        return
      }

      const blob = await response.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = file.name
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    } catch (e) {
      showToast({ variant: "error", title: "下载失败", description: "网络错误" })
    }
  }

  // 格式化大小
  const formatSize = (bytes?: number) => {
    if (!bytes) return "-"
    if (bytes < 1024) return bytes + " B"
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB"
    return (bytes / (1024 * 1024)).toFixed(1) + " MB"
  }

  // 文件图标
  const getFileIcon = (file: FileNode) => {
    if (file.type === "directory") {
      return "i-opencode-folder"
    }
    const ext = pathUtils.extname(file.name).toLowerCase()
    if ([".ts", ".tsx", ".js", ".jsx"].includes(ext)) return "i-opencode-code"
    if ([".css", ".scss", ".less"].includes(ext)) return "i-opencode-colors"
    if ([".html", ".htm"].includes(ext)) return "i-opencode-globe"
    if ([".json"].includes(ext)) return "i-opencode-braces"
    if ([".md"].includes(ext)) return "i-opencode-markdown"
    if ([".png", ".jpg", ".jpeg", ".gif", ".svg", ".ico"].includes(ext)) return "i-opencode-image"
    if ([".txt"].includes(ext)) return "i-opencode-file-text"
    return "i-opencode-file"
  }

  return (
    <Dialog title="文件管理" size="large">
      <div class="flex flex-col" style="height: 600px; padding: 0 20px 20px 20px;">
        {/* 工具栏 */}
        <div class="flex items-center gap-2 mb-4">
          <IconButton
            icon="arrow-left"
            variant="ghost"
            size="small"
            onClick={goUp}
            disabled={!canGoUp()}
            aria-label="返回上级"
          />
          <div class="flex-1" />
          <Button variant="ghost" size="small" onClick={() => setCreateDialogType("file")}>
            新建文件
          </Button>
          <Button variant="ghost" size="small" onClick={() => setCreateDialogType("directory")}>
            新建文件夹
          </Button>
          <Button variant="ghost" size="small" onClick={handleUpload}>
            上传
          </Button>
        </div>

        {/* 面包屑和提示 */}
        <div class="flex items-center justify-between gap-2 mb-3">
          <div class="flex items-center gap-1 text-14-regular text-text-base overflow-x-auto no-scrollbar">
            <For each={getBreadcrumbs()}>
              {(crumb, index) => (
                <>
                  {index() > 0 && <span class="text-text-weak">/</span>}
                  <button
                    class="hover:text-text-strong transition-colors"
                    onClick={() => setCurrentPath(crumb.path)}
                  >
                    {crumb.name}
                  </button>
                </>
              )}
            </For>
          </div>
          <div class="text-12-regular text-text-weak shrink-0 flex items-center gap-1">
            <span class="i-opencode-enter w-3 h-3" />
            双击进入文件夹
          </div>
        </div>

        {/* 文件列表 */}
        <div class="flex-1 border border-border-base rounded-md overflow-auto">
          <Show when={!loading()} fallback={<div class="p-4 text-center text-text-weak">加载中...</div>}>
            <Show
              when={files().length > 0}
              fallback={<div class="p-4 text-center text-text-weak">此文件夹为空</div>}
            >
              <table class="w-full text-14-regular">
                <thead class="bg-surface-base sticky top-0">
                  <tr class="text-left text-text-weak border-b border-border-base">
                    <th class="px-3 py-2 font-medium">名称</th>
                    <th class="px-3 py-2 font-medium w-24">类型</th>
                    <th class="px-3 py-2 font-medium w-24 text-right">大小</th>
                    <th class="px-3 py-2 font-medium w-16"></th>
                  </tr>
                </thead>
                <tbody>
                  <For each={files()}>
                    {(file) => (
                      <tr
                        class="hover:bg-surface-base-hover cursor-pointer"
                        onDblClick={() => enterDirectory(file)}
                      >
                        <td class="px-3 py-2">
                          <div class="flex items-center gap-2">
                            <span class={getFileIcon(file) + " w-4 h-4 text-icon-base"} />
                            <span>{file.name}</span>
                          </div>
                        </td>
                        <td class="px-3 py-2 text-text-weak">
                          {file.type === "directory" ? "文件夹" : "文件"}
                        </td>
                        <td class="px-3 py-2 text-text-weak text-right">{formatSize(file.size)}</td>
                        <td class="px-3 py-2">
                          <DropdownMenu placement="bottom-end">
                            <DropdownMenu.Trigger
                              as={IconButton}
                              icon="dot-grid"
                              variant="ghost"
                              size="small"
                              class="size-6 rounded-md hover:bg-surface-raised-base-hover hover:text-text-strong data-[expanded]:bg-surface-raised-base-active cursor-pointer"
                              aria-label="更多操作"
                              onClick={(e) => e.stopPropagation()}
                            />
                            <DropdownMenu.Portal>
                              <DropdownMenu.Content class="min-w-40 p-1">
                                <Show when={file.type === "directory"}>
                                  <DropdownMenu.Item
                                    class="flex items-center gap-2 px-3 py-2 text-14-regular hover:bg-surface-base-hover rounded-md cursor-pointer"
                                    onSelect={() => enterDirectory(file)}
                                  >
                                    <span class="i-opencode-enter w-4 h-4" />
                                    打开
                                  </DropdownMenu.Item>
                                </Show>
                                <Show when={file.type === "file"}>
                                  <DropdownMenu.Item
                                    class="flex items-center gap-2 px-3 py-2 text-14-regular hover:bg-surface-base-hover rounded-md cursor-pointer"
                                    onSelect={() => {
                                      setEditDialogFile(file)
                                    }}
                                  >
                                    <span class="i-opencode-edit w-4 h-4" />
                                    编辑
                                  </DropdownMenu.Item>
                                  <DropdownMenu.Item
                                    class="flex items-center gap-2 px-3 py-2 text-14-regular hover:bg-surface-base-hover rounded-md cursor-pointer"
                                    onSelect={() => handleDownload(file)}
                                  >
                                    <span class="i-opencode-download w-4 h-4" />
                                    下载
                                  </DropdownMenu.Item>
                                </Show>
                                <DropdownMenu.Item
                                  class="flex items-center gap-2 px-3 py-2 text-14-regular hover:bg-surface-base-hover rounded-md cursor-pointer"
                                  onSelect={() => {
                                    setRenameName(file.name)
                                    setRenameDialogFile(file)
                                  }}
                                >
                                  <span class="i-opencode-pencil w-4 h-4" />
                                  重命名
                                </DropdownMenu.Item>
                                <DropdownMenu.Item
                                  class="flex items-center gap-2 px-3 py-2 text-14-regular hover:bg-surface-base-hover rounded-md cursor-pointer"
                                  onSelect={() => {
                                    setMoveTargetPath(currentPath())
                                    setMoveDialogFile(file)
                                  }}
                                >
                                  <svg class="w-4 h-4" viewBox="0 0 20 20" fill="none" stroke="currentColor">
                                    <path d="M7.5 4.58398H2.5V17.5007H13.3333V13.334" stroke="currentColor" stroke-linecap="square"/>
                                    <path d="M7.91699 8.33398L11.667 12.084L7.91699 15.834" stroke="currentColor" stroke-linecap="square"/>
                                    <path d="M11.667 12.084H17.917" stroke="currentColor" stroke-linecap="square"/>
                                  </svg>
                                  移动
                                </DropdownMenu.Item>
                                <DropdownMenu.Item
                                  class="flex items-center gap-2 px-3 py-2 text-14-regular text-danger-base hover:bg-danger-surface rounded-md cursor-pointer"
                                  onSelect={() => handleDelete(file)}
                                >
                                  <span class="i-opencode-trash w-4 h-4" />
                                  删除
                                </DropdownMenu.Item>
                              </DropdownMenu.Content>
                            </DropdownMenu.Portal>
                          </DropdownMenu>
                        </td>
                      </tr>
                    )}
                  </For>
                </tbody>
              </table>
            </Show>
          </Show>
        </div>

        {/* 调试信息 */}
        <div class="text-12-regular text-text-weak mt-2">
          当前路径: {currentPath()} | 文件数: {files().length}
        </div>
      </div>

      {/* 新建对话框 - 内联模态框 */}
      <Show when={createDialogType()}>
        <div class="fixed inset-0 z-50 flex items-center justify-center">
          <div class="absolute inset-0 bg-black/50" onClick={closeSubDialog} />
          <div class="relative bg-surface-base border border-border-base rounded-lg shadow-xl w-96">
            <div class="px-4 py-3 border-b border-border-base text-16-semibold">
              {createDialogType() === "directory" ? "新建文件夹" : "新建文件"}
            </div>
            <div class="p-4 flex flex-col gap-4">
              <TextField
                value={createName()}
                onChange={setCreateName}
                placeholder={createDialogType() === "directory" ? "文件夹名称" : "文件名称"}
                onKeyDown={(e: KeyboardEvent) => e.key === "Enter" && handleCreate()}
                disabled={subDialogLoading()}
              />
              <div class="flex gap-2 justify-end">
                <Button variant="ghost" onClick={closeSubDialog} disabled={subDialogLoading()}>
                  取消
                </Button>
                <Button onClick={handleCreate} disabled={subDialogLoading()}>
                  {subDialogLoading() ? "创建中..." : "创建"}
                </Button>
              </div>
            </div>
          </div>
        </div>
      </Show>

      {/* 重命名对话框 - 内联模态框 */}
      <Show when={renameDialogFile()}>
        <div class="fixed inset-0 z-50 flex items-center justify-center">
          <div class="absolute inset-0 bg-black/50" onClick={closeSubDialog} />
          <div class="relative bg-surface-base border border-border-base rounded-lg shadow-xl w-96">
            <div class="px-4 py-3 border-b border-border-base text-16-semibold">重命名</div>
            <div class="p-4 flex flex-col gap-4">
              <TextField
                value={renameName()}
                onChange={setRenameName}
                placeholder="新名称"
                onKeyDown={(e: KeyboardEvent) => e.key === "Enter" && handleRename()}
                disabled={subDialogLoading()}
              />
              <div class="flex gap-2 justify-end">
                <Button variant="ghost" onClick={closeSubDialog} disabled={subDialogLoading()}>
                  取消
                </Button>
                <Button onClick={handleRename} disabled={subDialogLoading()}>
                  {subDialogLoading() ? "重命名中..." : "确定"}
                </Button>
              </div>
            </div>
          </div>
        </div>
      </Show>

      {/* 编辑对话框 - 可调整大小 */}
      <Show when={editDialogFile()}>
        <div class="fixed inset-0 z-50" onClick={closeSubDialog}>
          <div class="absolute inset-0 bg-black/50" />
          <div
            ref={(el) => {
              // 初始化居中位置
              if (editPosition().x === 0 && editPosition().y === 0) {
                const rect = el.getBoundingClientRect()
                setEditPosition({
                  x: (window.innerWidth - rect.width) / 2,
                  y: (window.innerHeight - rect.height) / 2,
                })
              }
            }}
            class="absolute bg-surface-base border border-border-base rounded-lg shadow-xl flex flex-col"
            onClick={(e) => e.stopPropagation()}
            style={editMaximized() ? {
              left: "0",
              top: "0",
              width: "100vw",
              height: "100vh",
              "border-radius": "0",
            } : {
              left: `${editPosition().x}px`,
              top: `${editPosition().y}px`,
              width: `${editSize().width}px`,
              height: `${editSize().height}px`,
              "min-width": "400px",
              "min-height": "300px",
            }}
          >
            {/* 标题栏 - 可拖拽 */}
            <div
              class="px-4 py-3 border-b border-border-base text-16-semibold flex items-center justify-between cursor-move select-none"
              onMouseDown={(e) => {
                if (editMaximized()) return
                if (e.button !== 0) return

                const startX = e.clientX - editPosition().x
                const startY = e.clientY - editPosition().y

                const handleMove = (moveEvent: MouseEvent) => {
                  setEditPosition({
                    x: moveEvent.clientX - startX,
                    y: moveEvent.clientY - startY,
                  })
                }

                const handleUp = () => {
                  document.removeEventListener("mousemove", handleMove)
                  document.removeEventListener("mouseup", handleUp)
                }

                document.addEventListener("mousemove", handleMove)
                document.addEventListener("mouseup", handleUp)
              }}
            >
              <span class="truncate">编辑: {editDialogFile()?.name}</span>
              <div class="flex items-center gap-1">
                <IconButton
                  icon={editMaximized() ? "collapse" : "expand"}
                  variant="ghost"
                  size="small"
                  onClick={(e) => {
                    e.stopPropagation()
                    setEditMaximized(!editMaximized())
                  }}
                  aria-label={editMaximized() ? "还原" : "最大化"}
                />
              </div>
            </div>

            {/* 内容区域 */}
            <div class="flex-1 flex flex-col gap-4 p-4 overflow-hidden">
              <Show
                when={!editLoading()}
                fallback={<div class="p-4 text-center text-text-weak">加载中...</div>}
              >
                <textarea
                  class="flex-1 w-full px-3 py-2 bg-surface-base border border-border-base rounded-md text-14-regular text-text-base focus:outline-none focus:border-border-strong resize-none font-mono"
                  value={editContent()}
                  onInput={(e) => setEditContent((e.target as HTMLTextAreaElement).value)}
                  disabled={subDialogLoading()}
                />
                <div class="flex gap-2 justify-end shrink-0">
                  <Button variant="ghost" onClick={closeSubDialog} disabled={subDialogLoading()}>
                    取消
                  </Button>
                  <Button onClick={handleSaveEdit} disabled={subDialogLoading()}>
                    {subDialogLoading() ? "保存中..." : "保存"}
                  </Button>
                </div>
              </Show>
            </div>

            {/* 拖拽调整大小手柄 */}
            <Show when={!editMaximized()}>
              <div
                class="absolute bottom-0 right-0 w-4 h-4 cursor-se-resize"
                style={{
                  background: "linear-gradient(135deg, transparent 50%, var(--text-weak) 50%)",
                }}
                onMouseDown={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  const startX = e.clientX
                  const startY = e.clientY
                  const startWidth = editSize().width
                  const startHeight = editSize().height

                  const handleMove = (moveEvent: MouseEvent) => {
                    const newWidth = Math.max(400, startWidth + (moveEvent.clientX - startX))
                    const newHeight = Math.max(300, startHeight + (moveEvent.clientY - startY))
                    setEditSize({ width: newWidth, height: newHeight })
                  }

                  const handleUp = () => {
                    document.removeEventListener("mousemove", handleMove)
                    document.removeEventListener("mouseup", handleUp)
                  }

                  document.addEventListener("mousemove", handleMove)
                  document.addEventListener("mouseup", handleUp)
                }}
              />
            </Show>
          </div>
        </div>
      </Show>

      {/* 移动对话框 - 内联模态框 */}
      <Show when={moveDialogFile()}>
        <div class="fixed inset-0 z-50 flex items-center justify-center">
          <div class="absolute inset-0 bg-black/50" onClick={closeSubDialog} />
          <div class="relative bg-surface-base border border-border-base rounded-lg shadow-xl w-[550px]">
            <div class="px-4 py-3 border-b border-border-base text-16-semibold">
              移动: {moveDialogFile()?.name}
            </div>
            <div class="p-4 flex flex-col gap-3">
              {/* 源文件信息 */}
              <div class="text-13-regular text-text-weak">
                源路径: {moveDialogFile()?.path}
              </div>

              {/* 目标路径显示 */}
              <div class="bg-surface-raised-base px-3 py-2 rounded-md">
                <div class="text-12-regular text-text-weak mb-1">目标目录:</div>
                <div class="text-14-regular text-text-strong font-mono break-all">
                  {moveTargetPath() || spacePath()}
                </div>
              </div>

              {/* 目录浏览器 */}
              <div class="border border-border-base rounded-md overflow-hidden">
                {/* 浏览器工具栏 */}
                <div class="flex items-center gap-2 px-3 py-2 bg-surface-raised-base border-b border-border-base">
                  <IconButton
                    icon="arrow-left"
                    variant="ghost"
                    size="small"
                    onClick={moveBrowserGoUp}
                    disabled={moveBrowserPath() === spacePath() || moveBrowserLoading()}
                    aria-label="返回上级"
                  />
                  <div class="flex-1 text-13-regular text-text-base truncate">
                    {moveBrowserPath() || spacePath()}
                  </div>
                  <IconButton
                    icon="reset"
                    variant="ghost"
                    size="small"
                    onClick={() => {
                      const sp = spacePath()
                      setMoveTargetPath(sp)
                      loadMoveBrowserDirs(sp)
                    }}
                    disabled={moveBrowserLoading()}
                    aria-label="回到根目录"
                  />
                </div>

                {/* 目录列表 */}
                <div class="max-h-48 overflow-y-auto">
                  <Show when={!moveBrowserLoading()} fallback={
                    <div class="p-4 text-center text-text-weak text-14-regular">加载中...</div>
                  }>
                    <Show
                      when={moveBrowserDirs().length > 0}
                      fallback={
                        <div class="p-4 text-center text-text-weak text-14-regular">
                          当前目录没有子文件夹
                        </div>
                      }
                    >
                      <For each={moveBrowserDirs()}>
                        {(dir) => (
                          <div
                            class="flex items-center gap-2 px-3 py-2 hover:bg-surface-base-hover cursor-pointer text-14-regular"
                            onClick={() => moveBrowserEnterDir(dir)}
                          >
                            <span class="i-opencode-folder w-4 h-4 text-icon-base" />
                            <span class="truncate">{dir.name}</span>
                            <span class="i-opencode-chevron-right w-4 h-4 text-text-weak ml-auto" />
                          </div>
                        )}
                      </For>
                    </Show>
                  </Show>
                </div>
              </div>

              {/* 提示信息 */}
              <div class="text-12-regular text-text-weak">
                点击文件夹进入，选择目标目录后点击"移动"按钮
              </div>

              {/* 操作按钮 */}
              <div class="flex gap-2 justify-end pt-2">
                <Button variant="ghost" onClick={closeSubDialog} disabled={moveLoading()}>
                  取消
                </Button>
                <Button onClick={handleMove} disabled={moveLoading()}>
                  {moveLoading() ? "移动中..." : "移动到此目录"}
                </Button>
              </div>
            </div>
          </div>
        </div>
      </Show>
    </Dialog>
  )
}
