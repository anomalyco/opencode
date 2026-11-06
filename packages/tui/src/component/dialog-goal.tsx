import { TextareaRenderable, TextAttributes } from "@opentui/core"
import { createEffect, createResource, createSignal, For, onMount, Show } from "solid-js"
import { useClient } from "../context/client"
import { Keymap } from "../context/keymap"
import { useTheme } from "../context/theme"
import { useDialog } from "../ui/dialog"
import { useToast } from "../ui/toast"

export function DialogGoal(props: { sessionID: string }) {
  const client = useClient()
  const dialog = useDialog()
  const toast = useToast()
  const theme = useTheme()
  const [focus, setFocus] = createSignal(0)
  const [busy, setBusy] = createSignal(false)
  const [deleting, setDeleting] = createSignal(false)
  const [editor, setEditor] = createSignal<TextareaRenderable>()
  const [loaded] = createResource(() => client.api.session.goalGet(props))
  createEffect(() => {
    const value = loaded()
    const target = editor()
    if (value && target) target.setText(value.goal?.objective ?? "")
  })
  createEffect(() => {
    if (focus() === 0 && loaded() && !busy()) editor()?.focus()
    else editor()?.blur()
  })
  const active = () => loaded()?.goal?.status === "active"
  const actions = () =>
    loaded()?.goal
      ? ["保存", active() ? "一時停止" : "再開", deleting() ? "もう一度押すと削除" : "削除", "閉じる"]
      : ["保存して開始", "閉じる"]
  async function save(status?: "active" | "paused") {
    if (!loaded() || busy()) return
    const objective = editor()?.plainText.trim() ?? ""
    if (!objective) return toast.error(new Error("ゴールを入力してください。"))
    setBusy(true)
    await client.api.session
      .goalSave({ sessionID: props.sessionID, objective, ...(status ? { status } : {}) })
      .then(() => dialog.clear())
      .catch(toast.error)
      .finally(() => setBusy(false))
  }
  async function remove() {
    if (!deleting()) return void setDeleting(true)
    setBusy(true)
    await client.api.session
      .goalRemove(props)
      .then(() => dialog.clear())
      .catch(toast.error)
      .finally(() => setBusy(false))
  }
  function act(index: number) {
    if (busy() || !loaded()) return
    if (index === 0) return void save()
    if (!loaded()?.goal || index === 3) return dialog.clear()
    if (index === 1) return void save(active() ? "paused" : "active")
    if (index === 2) return void remove()
  }
  Keymap.createLayer(() => ({
    mode: "modal",
    priority: 1,
    ...(focus() === 0 ? { target: editor } : {}),
    enabled: Boolean(loaded()) && !busy(),
    commands: [
      { bind: "tab", title: "次の項目", run: () => setFocus((value) => (value + 1) % (actions().length + 1)) },
      {
        bind: "shift+tab",
        title: "前の項目",
        run: () => setFocus((value) => (value + actions().length) % (actions().length + 1)),
      },
      { bind: "return", title: "選択", enabled: focus() > 0, run: () => act(focus() - 1) },
      { bind: "ctrl+return", title: "保存", run: () => void save() },
      { bind: "escape", title: "閉じる", run: () => dialog.clear() },
    ],
  }))
  onMount(() => dialog.setSize("large"))
  return (
    <box paddingLeft={2} paddingRight={2} paddingBottom={1} gap={1}>
      <text fg={theme.text.default} attributes={TextAttributes.BOLD}>
        ゴール
      </text>
      <text fg={theme.text.subdued}>
        {loaded()
          ? `状態: ${loaded()?.goal ? { active: "実行中", paused: "一時停止", blocked: "ブロック中", complete: "達成済み" }[loaded()!.goal!.status] : "未設定"} · 自動継続 ${loaded()?.continuationCount ?? 0}/50（直近10分） · 承認待ち ${loaded()?.approvalWaits ?? 0}/3`
          : loaded.error
            ? String(loaded.error)
            : "読み込み中…"}
      </text>
      <Show when={loaded()?.goal?.reason}>
        <text fg={theme.text.feedback.warning.default}>{loaded()?.goal?.reason}</text>
      </Show>
      <textarea
        ref={setEditor}
        height={8}
        wrapMode="word"
        placeholder="達成したいゴールを入力"
        textColor={theme.text.formfield.default}
        focusedTextColor={theme.text.formfield.focused}
        placeholderColor={theme.text.subdued}
        cursorColor={theme.text.formfield.focused}
        onMouseDown={() => setFocus(0)}
      />
      <box flexDirection="row" gap={1}>
        <For each={actions()}>
          {(label, index) => {
            const kind = loaded()?.goal && index() === 2 ? "destructive" : "primary"
            return (
              <box
                paddingLeft={1}
                paddingRight={1}
                backgroundColor={
                  focus() === index() + 1
                    ? theme.background.action[kind].focused
                    : theme.background.action[kind].default
                }
                onMouseUp={() => act(index())}
              >
                <text fg={focus() === index() + 1 ? theme.text.action[kind].focused : theme.text.action[kind].default}>
                  {label}
                </text>
              </box>
            )
          }}
        </For>
      </box>
      <text fg={theme.text.subdued}>
        {busy() ? "保存中…" : "Tab 項目移動 · Enter 選択 · Alt+Enter 改行 · Ctrl+Enter 保存 · Esc 閉じる"}
      </text>
    </box>
  )
}
