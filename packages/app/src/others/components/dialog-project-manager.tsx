import { useDialog } from "@opencode-ai/ui/context/dialog"
import { Dialog } from "@opencode-ai/ui/dialog"
import { FileIcon } from "@opencode-ai/ui/file-icon"
import { List } from "@opencode-ai/ui/list"
import { TextField } from "@opencode-ai/ui/text-field"
import { Button } from "@opencode-ai/ui/button"
import { createSignal, Show } from "solid-js"
import { useGlobalSync } from "@/context/global-sync"
import { useServer } from "@/context/server"
import { useLayout } from "@/context/layout"
import { useAuth } from "@/others"
import { useNavigate } from "@solidjs/router"
import { base64Encode } from "@opencode-ai/util/encode"
import { showToast } from "@opencode-ai/ui/toast"

interface FileNode {
  name: string
  path: string
  type: "file" | "directory"
}

type TabType = "open" | "create"

interface DialogProjectManagerProps {
  onSuccess?: (projectPath: string) => void
}

function keyDown(handler: () => void) {
  return (e: KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault()
      handler()
    }
  }
}

export function DialogProjectManager(props: DialogProjectManagerProps) {
  const sync = useGlobalSync()
  const server = useServer()
  const auth = useAuth()
  const layout = useLayout()
  const dialog = useDialog()
  const navigate = useNavigate()

  // Tab 状态
  const [activeTab, setActiveTab] = createSignal<TabType>("open")

  // 创建项目状态
  const [projectName, setProjectName] = createSignal("")
  const [loading, setLoading] = createSignal(false)
  const [error, setError] = createSignal("")

  // 浏览目录状态
  const [directories, setDirectories] = createSignal<FileNode[]>([])
  const [browseLoading, setBrowseLoading] = createSignal(false)

  const home = () => sync.data.path.home || ""
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

  // 加载目录列表
  const loadDirectories = async () => {
    const sp = spacePath()
    if (!sp) return

    setBrowseLoading(true)
    try {
      const result = await apiRequest(`/list`, { method: "GET" })

      if (result.success && result.data?.files) {
        // 只显示目录
        const dirs = result.data.files.filter((f: FileNode) => f.type === "directory")
        setDirectories(dirs)
      } else {
        showToast({ variant: "error", title: "加载失败", description: result.message })
      }
    } finally {
      setBrowseLoading(false)
    }
  }

  // 当切换到打开 tab 时加载目录
  const handleTabChange = (tab: TabType) => {
    setActiveTab(tab)
    if (tab === "open") {
      loadDirectories()
    }
  }

  // 初始化加载
  const initLoad = () => {
    if (activeTab() === "open" && directories().length === 0) {
      loadDirectories()
    }
  }

  // 创建项目
  const handleCreateProject = async () => {
    const name = projectName().trim()
    if (!name) {
      setError("请输入项目名称")
      return
    }

    // 简单验证：只允许字母、数字、下划线、中划线和中文
    if (!/^[\w\u4e00-\u9fa5-]+$/.test(name)) {
      setError("项目名称只能包含字母、数字、下划线、中划线和中文")
      return
    }

    setLoading(true)
    setError("")

    try {
      const currentServer = server.current
      if (!currentServer) {
        setError("服务器未连接")
        return
      }

      // 构建请求头
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      }

      // 添加 token
      if (auth.token) {
        headers["Authorization"] = `Bearer ${auth.token}`
      }

      // 调用后端 API 创建项目
      const response = await fetch(`${currentServer.http.url}/others/project/create`, {
        method: "POST",
        headers,
        body: JSON.stringify({ name }),
      })

      if (!response.ok) {
        throw new Error("创建项目失败")
      }

      const result = await response.json()

      if (result.success) {
        showToast({
          variant: "success",
          title: "创建成功",
          description: `项目 "${name}" 已创建`,
        })

        // 调用成功回调
        props.onSuccess?.(result.path)

        // 导航到新项目
        navigate(`/${base64Encode(result.path)}`)

        dialog.close()
      } else {
        setError(result.message || "创建项目失败")
      }
    } catch (e) {
      setError("创建项目失败，请重试")
    } finally {
      setLoading(false)
    }
  }

  // 打开目录作为项目
  const handleOpenProject = (dir: FileNode) => {
    // 添加到项目列表
    layout.projects.open(dir.path)
    server.projects.touch(dir.path)

    // 导航到项目
    navigate(`/${base64Encode(dir.path)}`)

    // 调用成功回调
    props.onSuccess?.(dir.path)

    dialog.close()
  }

  // List 组件的 items 函数
  const listItems = async (filter: string) => {
    // 如果还没加载，先加载
    if (directories().length === 0 && !browseLoading()) {
      await loadDirectories()
    }

    const dirs = directories()
    if (!filter) return dirs

    // 简单的过滤
    const lowerFilter = filter.toLowerCase()
    return dirs.filter((d) => d.name.toLowerCase().includes(lowerFilter))
  }

  return (
    <Dialog title="打开项目" size="large">
      <div class="flex flex-col" style="min-height: 400px; max-height: 500px;">
        {/* Tab 切换 */}
        <div class="flex border-b border-border-base">
          <button
            class={`px-4 py-2 text-14-medium transition-colors ${
              activeTab() === "open"
                ? "text-text-strong border-b-2 border-text-interactive-base"
                : "text-text-weak hover:text-text-base"
            }`}
            onClick={() => handleTabChange("open")}
          >
            打开项目
          </button>
          <button
            class={`px-4 py-2 text-14-medium transition-colors ${
              activeTab() === "create"
                ? "text-text-strong border-b-2 border-text-interactive-base"
                : "text-text-weak hover:text-text-base"
            }`}
            onClick={() => handleTabChange("create")}
          >
            创建项目
          </button>
        </div>

        {/* 打开项目 Tab */}
        <Show when={activeTab() === "open"}>
          <div class="flex-1 min-h-0 pt-3">
            <List
              search={{ placeholder: "搜索目录...", autofocus: true }}
              emptyMessage="没有可用的目录"
              loadingMessage="加载中..."
              items={listItems}
              key={(x) => x.path}
              filterKeys={["name"]}
              ref={() => initLoad()}
              onSelect={(item) => {
                if (item) handleOpenProject(item)
              }}
            >
              {(item) => (
                <div class="w-full flex items-center justify-between rounded-md">
                  <div class="flex items-center gap-x-3 grow min-w-0">
                    <FileIcon node={{ path: item.path, type: "directory" }} class="shrink-0 size-4" />
                    <div class="flex items-center text-14-regular min-w-0">
                      <span class="text-text-strong whitespace-nowrap overflow-hidden overflow-ellipsis truncate">
                        {item.name}
                      </span>
                      <span class="text-text-weak whitespace-nowrap">/</span>
                    </div>
                  </div>
                </div>
              )}
            </List>
          </div>
        </Show>

        {/* 创建项目 Tab */}
        <Show when={activeTab() === "create"}>
          <div class="flex flex-col gap-4 p-5">
            <div class="text-12-regular text-text-weak">
              将在 {home()} 下创建项目目录
            </div>

            <div class="flex flex-col gap-1">
              <label class="text-14-regular text-text-strong">项目名称</label>
              <TextField
                value={projectName()}
                onChange={setProjectName}
                placeholder="例如：my-project"
                onKeyDown={keyDown(handleCreateProject)}
                disabled={loading()}
                error={error()}
              />
            </div>

            <div class="flex gap-2 justify-end mt-2">
              <Button variant="ghost" onClick={() => dialog.close()} disabled={loading()}>
                取消
              </Button>
              <Button onClick={handleCreateProject} disabled={loading()}>
                {loading() ? "创建中..." : "创建"}
              </Button>
            </div>
          </div>
        </Show>
      </div>
    </Dialog>
  )
}
