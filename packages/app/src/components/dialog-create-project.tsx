import { useDialog } from "@opencode-ai/ui/context/dialog"
import { Dialog } from "@opencode-ai/ui/dialog"
import { TextField } from "@opencode-ai/ui/text-field"
import { Button } from "@opencode-ai/ui/button"
import { createSignal } from "solid-js"
import { useGlobalSync } from "@/context/global-sync"
import { useServer } from "@/context/server"
import { useAuth } from "@/others"
import { useNavigate } from "@solidjs/router"
import { base64Encode } from "@opencode-ai/util/encode"
import { showToast } from "@opencode-ai/ui/toast"

interface DialogCreateProjectProps {
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

export function DialogCreateProject(props: DialogCreateProjectProps) {
  const sync = useGlobalSync()
  const server = useServer()
  const auth = useAuth()
  const dialog = useDialog()
  const navigate = useNavigate()

  const [projectName, setProjectName] = createSignal("")
  const [loading, setLoading] = createSignal(false)
  const [error, setError] = createSignal("")

  const home = () => sync.data.path.home || ""

  async function handleSubmit() {
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

  return (
    <Dialog title="创建项目">
      <div class="flex flex-col gap-4">
        <div class="text-12-regular text-text-weak">
          将在 {home()} 下创建项目目录
        </div>

        <div class="flex flex-col gap-1">
          <label class="text-14-regular text-text-strong">项目名称</label>
          <TextField
            value={projectName()}
            onChange={setProjectName}
            placeholder="例如：my-project"
            onKeyDown={keyDown(handleSubmit)}
            disabled={loading()}
            error={error()}
          />
        </div>

        <div class="flex gap-2 justify-end">
          <Button variant="ghost" onClick={() => dialog.close()} disabled={loading()}>
            取消
          </Button>
          <Button onClick={handleSubmit} disabled={loading()}>
            {loading() ? "创建中..." : "创建"}
          </Button>
        </div>
      </div>
    </Dialog>
  )
}
