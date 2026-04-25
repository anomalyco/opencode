import { createSignal, onCleanup, onMount, Show, type JSX } from "solid-js"

export type OfficeToolingStatus = {
  installed: boolean
  sofficePath?: string
  platformSupported: boolean
  downloadSizeMB?: number
  selectedMirror?: { name: string; url: string }
  progress: OfficeToolingProgress
}

export type OfficeToolingProgress = {
  phase: "idle" | "probing" | "downloading" | "installing" | "done" | "error"
  bytesDownloaded?: number
  bytesTotal?: number
  percent?: number
  speedBps?: number
  message?: string
  mirrorName?: string
}

export type OfficeToolingApi = {
  getStatus: () => Promise<OfficeToolingStatus | undefined>
  startInstall: () => Promise<OfficeToolingProgress | undefined>
  getProgress: () => Promise<OfficeToolingProgress | undefined>
}

function formatBytes(b?: number): string {
  if (!b) return "0B"
  if (b < 1024) return `${b}B`
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)}KB`
  if (b < 1024 * 1024 * 1024) return `${(b / 1024 / 1024).toFixed(1)}MB`
  return `${(b / 1024 / 1024 / 1024).toFixed(2)}GB`
}

function formatSpeed(bps?: number): string {
  if (!bps || bps <= 0) return ""
  return `${formatBytes(bps)}/s`
}

const STYLES = `
.oc-install-btn-primary {
  background: #2563eb;
  color: #fff;
  padding: 10px 20px;
  border-radius: 6px;
  font-weight: 600;
  font-size: 14px;
  border: none;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  transition: background 150ms ease, transform 80ms ease, box-shadow 150ms ease;
  box-shadow: 0 1px 2px rgba(37, 99, 235, 0.18);
}
.oc-install-btn-primary:hover {
  background: #1d4ed8;
  box-shadow: 0 2px 6px rgba(37, 99, 235, 0.28);
}
.oc-install-btn-primary:active {
  background: #1e3a8a;
  transform: scale(0.97);
  box-shadow: 0 1px 1px rgba(37, 99, 235, 0.18);
}
.oc-install-btn-primary:disabled {
  opacity: 0.5;
  cursor: not-allowed;
  transform: none;
  box-shadow: none;
}
.oc-install-btn-secondary {
  background: transparent;
  color: #374151;
  padding: 10px 20px;
  border-radius: 6px;
  font-weight: 500;
  font-size: 14px;
  border: 1px solid #d1d5db;
  cursor: pointer;
  transition: background 150ms ease, transform 80ms ease, border-color 150ms ease;
}
.oc-install-btn-secondary:hover {
  background: #f3f4f6;
  border-color: #9ca3af;
}
.oc-install-btn-secondary:active {
  background: #e5e7eb;
  transform: scale(0.97);
}
`

const PROGRESS_BAR_BG: JSX.CSSProperties = {
  height: "10px",
  "border-radius": "5px",
  background: "#e5e7eb",
  overflow: "hidden",
  width: "100%",
}

const PROGRESS_BAR_FILL = (percent: number): JSX.CSSProperties => ({
  height: "100%",
  background: "linear-gradient(90deg, #2563eb 0%, #3b82f6 100%)",
  width: `${Math.max(2, Math.min(100, percent))}%`,
  transition: "width 0.4s ease-out",
})

export function OfficeInstallPrompt(props: {
  fileName: string
  fileExt: string
  api?: OfficeToolingApi
  onRetryFile?: () => void
  onOpenExternal?: () => void
}): JSX.Element {
  const [status, setStatus] = createSignal<OfficeToolingStatus | undefined>(undefined)
  const [progress, setProgress] = createSignal<OfficeToolingProgress>({ phase: "idle" })
  const [polling, setPolling] = createSignal(false)
  const [errorMsg, setErrorMsg] = createSignal<string | undefined>(undefined)

  let pollTimer: ReturnType<typeof setInterval> | undefined

  const stopPolling = () => {
    if (pollTimer) {
      clearInterval(pollTimer)
      pollTimer = undefined
    }
    setPolling(false)
  }

  onCleanup(stopPolling)

  const refreshStatus = async () => {
    const s = await props.api?.getStatus().catch(() => undefined)
    if (s) {
      setStatus(s)
      setProgress(s.progress)
      if (s.progress.phase === "done" || s.progress.phase === "error") stopPolling()
    }
  }

  onMount(() => {
    void refreshStatus()
  })

  const startPolling = () => {
    if (pollTimer) return
    setPolling(true)
    pollTimer = setInterval(() => {
      void (async () => {
        const p = await props.api?.getProgress().catch(() => undefined)
        if (p) {
          setProgress(p)
          if (p.phase === "done" || p.phase === "error") {
            stopPolling()
            void refreshStatus()
          }
        }
      })()
    }, 1000)
  }

  const handleInstall = async () => {
    setErrorMsg(undefined)
    setProgress({ phase: "probing", message: "正在选择最快下载源…" })
    startPolling()
    const result = await props.api?.startInstall().catch((e) => {
      setErrorMsg(String(e))
      return undefined
    })
    if (result) {
      setProgress(result)
      if (result.phase === "done") {
        stopPolling()
        void refreshStatus()
      }
    }
  }

  const phase = () => progress().phase
  const isWorking = () => phase() === "probing" || phase() === "downloading" || phase() === "installing"

  return (
    <div class="flex min-h-72 flex-col items-center justify-center gap-5 px-6 py-12 text-center">
      <style>{STYLES}</style>

      <Show when={!status()?.installed && !isWorking() && phase() !== "done"}>
        <div style={{ "max-width": "520px" }}>
          <div class="text-16-semibold text-text-strong" style={{ "margin-bottom": "8px" }}>
            需要安装 office 预览插件
          </div>
          <div class="text-14-regular text-text-weak" style={{ "line-height": "1.6" }}>
            <strong>{props.fileName}</strong> 是 office 文档。OpenCode 用 LibreOffice 引擎在
            内置查看器里渲染 .docx / .xlsx / .pptx 等格式，<strong>一次安装，永久受用</strong>，
            后续预览全部秒开，文字可复制可搜索。
          </div>
          <Show when={status()?.platformSupported === false}>
            <div class="text-13-regular" style={{ color: "#dc2626", "margin-top": "12px" }}>
              当前平台暂不支持自动安装，请手动安装 LibreOffice 后重启 OpenCode。
            </div>
          </Show>
          <Show when={phase() === "error" || errorMsg()}>
            <div class="text-13-regular" style={{ color: "#dc2626", "margin-top": "12px" }}>
              上次安装失败：{progress().message ?? errorMsg() ?? "未知错误"}
            </div>
          </Show>
        </div>

        <div style={{ display: "flex", gap: "12px", "flex-wrap": "wrap", "justify-content": "center" }}>
          <button
            type="button"
            class="oc-install-btn-primary"
            disabled={status()?.platformSupported === false}
            onClick={handleInstall}
          >
            ⬇ 下载预览插件
            <Show when={status()?.downloadSizeMB}>
              {(s) => <span style={{ opacity: 0.8, "font-weight": 400 }}>（约 {s()} MB）</span>}
            </Show>
          </button>
          <Show when={props.onOpenExternal}>
            <button
              type="button"
              class="oc-install-btn-secondary"
              onClick={() => props.onOpenExternal?.()}
            >
              改用本机 Office 软件打开
            </button>
          </Show>
        </div>

        <div class="text-12-regular text-text-weak" style={{ "max-width": "520px" }}>
          安装到本用户目录、不需要管理员权限、不弹 UAC 提示
        </div>
      </Show>

      <Show when={isWorking()}>
        <div style={{ width: "100%", "max-width": "520px" }}>
          <div class="text-14-semibold text-text-strong" style={{ "margin-bottom": "12px" }}>
            <Show
              when={phase() === "probing"}
              fallback={
                <Show when={phase() === "downloading"} fallback={<>正在静默安装到本用户目录…</>}>
                  下载中… {progress().percent ?? 0}%
                </Show>
              }
            >
              正在选择最快下载源…
            </Show>
          </div>
          <div style={PROGRESS_BAR_BG}>
            <div
              style={PROGRESS_BAR_FILL(
                phase() === "installing" ? 100 : phase() === "probing" ? 5 : (progress().percent ?? 0),
              )}
            />
          </div>
          <Show when={phase() === "downloading"}>
            <div
              class="text-13-regular text-text-weak"
              style={{
                display: "flex",
                "justify-content": "space-between",
                "margin-top": "8px",
              }}
            >
              <span>
                {formatBytes(progress().bytesDownloaded)} / {formatBytes(progress().bytesTotal)}
              </span>
              <Show when={progress().speedBps}>
                <span>{formatSpeed(progress().speedBps)}</span>
              </Show>
            </div>
            <Show when={progress().mirrorName}>
              <div class="text-12-regular text-text-weak" style={{ "margin-top": "4px" }}>
                镜像源：{progress().mirrorName}
              </div>
            </Show>
          </Show>
          <Show when={phase() === "installing"}>
            <div class="text-12-regular text-text-weak" style={{ "margin-top": "8px" }}>
              静默安装通常 30-60 秒，请勿关闭 OpenCode
            </div>
          </Show>
        </div>
      </Show>

      <Show when={status()?.installed || phase() === "done"}>
        <div style={{ "text-align": "center" }}>
          <div class="text-16-semibold" style={{ color: "#16a34a", "margin-bottom": "12px" }}>
            ✓ LibreOffice 已就绪
          </div>
          <button type="button" class="oc-install-btn-primary" onClick={() => props.onRetryFile?.()}>
            重新加载文件
          </button>
        </div>
      </Show>
    </div>
  )
}
