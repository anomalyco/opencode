// quota.tsx — 在 session prompt 右侧显示 GitHub Copilot premium request 配额。
// 数据源：github-copilot OAuth refresh token → GitHub /copilot_internal/user。
//
// 重要：opentui Slot 在初始渲染时若返回空内容，会永久跳过本插件。
// 因此组件在数据就绪前显示 "⊘ …" 占位。
import type { TuiPlugin, TuiPluginApi, TuiPluginModule } from "@opencode-ai/plugin/tui"
import { createSignal, onCleanup } from "solid-js"
import { Global } from "@opencode-ai/core/global"
import { fetchQuota, readQuotaAuth, type QuotaAuth, type QuotaInfo } from "./quota-fetch"

const id = "internal:session-quota"

function QuotaView(props: { api: TuiPluginApi }) {
  const theme = () => props.api.theme.current
  const [label, setLabel] = createSignal("⊘ …")
  const [tone, setTone] = createSignal<"muted" | "success" | "warning" | "error">("muted")
  const color = () => {
    const t = theme()
    switch (tone()) {
      case "success":
        return t.success
      case "warning":
        return t.warning
      case "error":
        return t.error
      default:
        return t.textMuted
    }
  }
  const [quotaAuth, setQuotaAuth] = createSignal<QuotaAuth | null>(null)

  function applyQuota(q: QuotaInfo) {
    // 后端 remaining 字段实际是 used（已用量），需翻转为真正的剩余量
    const actual = q.entitlement - q.remaining
    const pct = Math.round((actual / Math.max(q.entitlement, 1)) * 100)
    setTone(pct > 30 ? "success" : pct > 10 ? "warning" : "error")
    setLabel(`⊘ ${actual}/${q.entitlement}`)
  }

  // 启动：读 auth → 首次拉取
  // 注意：auth.json 位于 Global.Path.data（XDG_DATA_HOME），
  // 不能用 props.api.state.path.state（XDG_STATE_HOME），二者是不同目录。
  readQuotaAuth(Global.Path.data).then((auth) => {
    if (!auth) {
      setLabel("")
      return
    }
    setQuotaAuth(auth)
    fetchQuota(auth).then((q) => {
      if (q) applyQuota(q)
      else setLabel("")
    })
  })

  // 每 60 秒刷新
  const timer = setInterval(async () => {
    const auth = quotaAuth()
    if (!auth) return
    const q = await fetchQuota(auth)
    if (q) applyQuota(q)
  }, 60_000)
  onCleanup(() => clearInterval(timer))

  // 必须返回非空内容（即使是占位符），否则 opentui Slot 永久跳过本插件
  return (
    <text>
      <span style={{ fg: color() }}>{label()}</span>
    </text>
  )
}

const tui: TuiPlugin = async (api) => {
  api.slots.register({
    order: 100,
    slots: {
      session_prompt_right() {
        return <QuotaView api={api} />
      },
    },
  })
}

const plugin: TuiPluginModule & { id: string } = {
  id,
  tui,
}

export default plugin
