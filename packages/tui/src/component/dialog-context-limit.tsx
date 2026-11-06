import { TextareaRenderable, TextAttributes } from "@opentui/core"
import { createEffect, createResource, createSignal, onMount } from "solid-js"
import { useClient } from "../context/client"
import { Keymap } from "../context/keymap"
import { useTheme } from "../context/theme"
import { useDialog } from "../ui/dialog"
import { useToast } from "../ui/toast"

export function DialogContextLimit(props: { sessionID: string }) {
  const client = useClient()
  const dialog = useDialog()
  const toast = useToast()
  const theme = useTheme()
  const [busy, setBusy] = createSignal(false)
  const [editor, setEditor] = createSignal<TextareaRenderable>()
  const [loaded] = createResource(async () => ({ tokens: await client.api.session.contextLimitGet(props) }))
  createEffect(() => {
    const current = loaded()
    const target = editor()
    if (!current || !target) return
    target.setText(current.tokens === null ? "" : String(current.tokens / 1000))
    target.focus()
  })
  async function save() {
    if (!loaded() || busy()) return
    const text = editor()?.plainText.trim() ?? ""
    const tokens = text ? Number(text) * 1000 : null
    if (text && (!/^\d+$/.test(text) || !Number.isSafeInteger(tokens) || tokens! < 1000)) {
      toast.error(new Error("1以上の整数をK単位で入力してください。"))
      return
    }
    setBusy(true)
    await client.api.session
      .contextLimitSet({ sessionID: props.sessionID, tokens })
      .then(() => dialog.clear())
      .catch(toast.error)
      .finally(() => setBusy(false))
  }
  Keymap.createLayer(() => ({
    mode: "modal",
    priority: 1,
    target: editor,
    enabled: Boolean(loaded()) && !busy(),
    commands: [
      { bind: "return", title: "保存", run: () => void save() },
      { bind: "escape", title: "閉じる", run: () => dialog.clear() },
    ],
  }))
  onMount(() => dialog.setSize("medium"))
  return (
    <box paddingLeft={2} paddingRight={2} paddingBottom={1} gap={1}>
      <text fg={theme.text.base} attributes={TextAttributes.BOLD}>
        総コンテキスト上限（K tokens）
      </text>
      <text fg={theme.text.muted}>1000 = 1,000,000 tokens。空欄でモデル既定値に戻します。</text>
      <textarea
        ref={setEditor}
        height={1}
        wrapMode="none"
        placeholder="例: 1000"
        textColor={theme.text.formfield.base}
        focusedTextColor={theme.text.formfield.focused}
        placeholderColor={theme.text.muted}
        cursorColor={theme.text.formfield.focused}
      />
      <text fg={theme.text.muted}>{busy() ? "保存中…" : "Enter 保存 · Esc 閉じる · 次のモデル呼び出しから反映"}</text>
    </box>
  )
}
