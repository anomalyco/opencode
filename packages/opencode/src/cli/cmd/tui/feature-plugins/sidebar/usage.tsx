import type { TuiPlugin, TuiPluginApi, TuiPluginModule } from "@opencode-ai/plugin/tui"
import { Auth } from "@/auth"
import { CopilotUsage, UsageError } from "@/plugin/github-copilot/usage"
import { createEffect, createMemo, createSignal, onCleanup, onMount } from "solid-js"

const id = "internal:sidebar-usage"

function View(props: { api: TuiPluginApi; session_id: string }) {
  const theme = () => props.api.theme.current
  const msg = createMemo(() => props.api.state.session.messages(props.session_id))
  const [used, setUsed] = createSignal("--")
  const [total, setTotal] = createSignal("--")
  const [pct, setPct] = createSignal<number | undefined>()
  const provider = createMemo(() => {
    const item = msg().at(-1)
    if (!item) return
    if (item.role === "assistant") return item.providerID
    if (item.role === "user") return item.model.providerID
    return
  })
  const active = createMemo(() => provider()?.includes("github-copilot") === true)
  let last = 0

  const update = (force = false) => {
    if (!active()) {
      setUsed("不可用")
      setTotal("")
      setPct(undefined)
      return
    }
    if (!force && Date.now() - last < 15_000) return
    last = Date.now()
    Auth.get("github-copilot")
      .then((auth) => {
        if (!auth || auth.type !== "oauth") throw new UsageError("not_logged_in")
        return CopilotUsage.get({
          token: auth.refresh,
          enterpriseUrl: auth.enterpriseUrl,
        })
      })
      .then((data) => {
        const sum = CopilotUsage.brief({ usage: data })
        setUsed(sum.used)
        setTotal(sum.total === "无限" ? "∞" : sum.total)
        setPct(sum.percent)
      })
      .catch(() => {
        setUsed("--")
        setTotal("--")
        setPct(undefined)
      })
  }

  onMount(() => {
    update(true)
  })
  const timer = setInterval(() => update(), 5 * 60 * 1000)
  onCleanup(() => clearInterval(timer))

  createEffect(() => {
    const list = msg()
    const item = list.at(-1)
    if (!item || item.role !== "assistant") return
    if (!item.time.completed) return
    if (!item.providerID.includes("github-copilot")) return
    update()
  })

  createEffect(() => {
    active()
    update(true)
  })

  const bar = createMemo(() => {
    const val = pct()
    if (typeof val !== "number") {
      return {
        left: "──────────────",
        right: "",
        color: theme().textMuted,
      }
    }
    const max = 14
    const fill = Math.round((Math.max(0, Math.min(100, val)) / 100) * max)
    return {
      left: "█".repeat(fill),
      right: "░".repeat(Math.max(max - fill, 0)),
      color: val >= 90 ? theme().error : val >= 75 ? theme().warning : theme().success,
    }
  })

  return (
    <box>
      <text fg={theme().text}>
        <b>Usage</b>
      </text>
      <text fg={theme().textMuted}>
        <span style={{ fg: bar().color }}>{bar().left}</span>
        <span style={{ fg: theme().textMuted }}>{bar().right}</span> {total() ? `${used()}/${total()}` : used()}
      </text>
    </box>
  )
}

const tui: TuiPlugin = async (api) => {
  api.slots.register({
    order: 120,
    slots: {
      sidebar_content(_ctx, props) {
        return <View api={api} session_id={props.session_id} />
      },
    },
  })
}

const plugin: TuiPluginModule & { id: string } = {
  id,
  tui,
}

export default plugin
