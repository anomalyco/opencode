import { TextAttributes } from "@opentui/core"
import { useDialog } from "@tui/ui/dialog"
import { useTheme } from "@tui/context/theme"
import { useLocal } from "@tui/context/local"
import { Auth } from "@/auth"
import { CopilotUsage, UsageError } from "@/plugin/github-copilot/usage"
import { createMemo, createSignal, onMount, Show } from "solid-js"

export function DialogUsage() {
  const dialog = useDialog()
  const { theme } = useTheme()
  const local = useLocal()
  const [state, setState] = createSignal<
    | { type: "loading" }
    | {
        type: "ready"
        used: string
        remaining: string
        total: string
        reset: string
      }
    | { type: "error"; message: string }
  >({ type: "loading" })

  const model = createMemo(() => local.model.current())

  onMount(() => {
    const current = model()
    if (!current || !current.providerID.includes("github-copilot")) {
      setState({
        type: "error",
        message: "当前模型不是 GitHub Copilot，Usage 暂不可用。",
      })
      return
    }

    Auth.get("github-copilot")
      .then((auth) => {
        if (!auth || auth.type !== "oauth") throw new UsageError("not_logged_in")
        return CopilotUsage.get({
          token: auth.refresh,
          enterpriseUrl: auth.enterpriseUrl,
        })
      })
      .then((usage) => {
        const sum = CopilotUsage.brief({ usage })
        setState({
          type: "ready",
          used: sum.used,
          remaining: sum.remaining,
          total: sum.total,
          reset: sum.reset,
        })
      })
      .catch((err) => {
        setState({
          type: "error",
          message: CopilotUsage.explain(err),
        })
      })
  })

  return (
    <box paddingLeft={2} paddingRight={2} gap={1} paddingBottom={1}>
      <box flexDirection="row" justifyContent="space-between">
        <text fg={theme.text} attributes={TextAttributes.BOLD}>
          Usage
        </text>
        <text fg={theme.textMuted} onMouseUp={() => dialog.clear()}>
          esc
        </text>
      </box>

      <Show when={state().type === "loading"}>
        <text fg={theme.textMuted}>正在查询 Copilot 额度...</text>
      </Show>

      <Show when={state().type === "error" && state().type !== "loading"}>
        <text fg={theme.error}>{(state() as { type: "error"; message: string }).message}</text>
      </Show>

      <Show when={state().type === "ready" && state().type !== "loading"}>
        <box gap={0}>
          <text fg={theme.text}>
            使用额度: <span style={{ fg: theme.textMuted }}>{(state() as { type: "ready"; used: string }).used}</span>
          </text>
          <text fg={theme.text}>
            剩余额度:{" "}
            <span style={{ fg: theme.textMuted }}>{(state() as { type: "ready"; remaining: string }).remaining}</span>
          </text>
          <text fg={theme.text}>
            总额度: <span style={{ fg: theme.textMuted }}>{(state() as { type: "ready"; total: string }).total}</span>
          </text>
          <text fg={theme.text}>
            刷新时间: <span style={{ fg: theme.textMuted }}>{(state() as { type: "ready"; reset: string }).reset}</span>
          </text>
        </box>
      </Show>
    </box>
  )
}
