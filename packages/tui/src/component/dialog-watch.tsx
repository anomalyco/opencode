import { TextareaRenderable, TextAttributes } from "@opentui/core"
import { createEffect, createResource, createSignal, For, onMount, Show } from "solid-js"
import { useClient } from "../context/client"
import { Keymap } from "../context/keymap"
import { useTheme } from "../context/theme"
import { useConfig } from "../config"
import { useDialog } from "../ui/dialog"
import { useToast } from "../ui/toast"

export function DialogWatch(props: { sessionID: string }) {
  const client = useClient()
  const dialog = useDialog()
  const toast = useToast()
  const theme = useTheme()
  const config = useConfig().data
  const [focus, setFocus] = createSignal(0)
  const [position, setPosition] = createSignal(0)
  const [members, setMembers] = createSignal<readonly string[]>([])
  const [enabled, setEnabled] = createSignal(true)
  const [busy, setBusy] = createSignal(false)
  const [deleting, setDeleting] = createSignal(false)
  const [error, setError] = createSignal("")
  const [editor, setEditor] = createSignal<TextareaRenderable>()
  const [loaded] = createResource(async () => {
    const watch = await client.api.session.watchGet({ sessionID: props.sessionID })
    const sessions = []
    let cursor: string | undefined
    do {
      const page = await client.api.session.list({ cursor, limit: 100, order: "desc" })
      sessions.push(...page.data)
      cursor = page.cursor.next ?? undefined
    } while (cursor)
    setMembers(watch?.members ?? [])
    setEnabled(watch?.enabled ?? true)
    return { watch, sessions }
  })
  const options = () => loaded()?.sessions.filter((session) => session.id !== props.sessionID) ?? []
  const offset = () => Math.max(0, position() - 7)
  const toggleMember = (id: string) =>
    setMembers((value) => (value.includes(id) ? value.filter((item) => item !== id) : [...value, id]))
  async function save(state = enabled()) {
    if (busy() || !loaded()) return
    const text = editor()?.plainText ?? ""
    if (members().length === 0 || !text.trim()) {
      setError("1人以上のエージェントと通知文を設定してください。")
      return
    }
    setBusy(true)
    await client.api.session
      .watchSave({ sessionID: props.sessionID, members: [...members()], text, enabled: state })
      .then(() => dialog.clear())
      .catch(toast.error)
      .finally(() => setBusy(false))
  }
  async function remove() {
    if (!deleting()) {
      setDeleting(true)
      return
    }
    setBusy(true)
    await client.api.session
      .watchRemove({ sessionID: props.sessionID })
      .then(() => dialog.clear())
      .catch(toast.error)
      .finally(() => setBusy(false))
  }
  const actions = () =>
    loaded()?.watch
      ? ["保存", enabled() ? "一時停止" : "再開", deleting() ? "もう一度押すと削除" : "設定を削除", "キャンセル"]
      : ["保存", "キャンセル"]
  const act = (index: number) => {
    if (busy()) return
    if (index === 0) return void save()
    if (!loaded()?.watch || index === 3) return dialog.clear()
    if (index === 1) return void save(!enabled())
    if (index === 2) return void remove()
  }
  Keymap.createLayer(() => ({
    mode: "modal",
    priority: 1,
    ...(focus() === 1 ? { target: editor } : {}),
    enabled: !busy(),
    commands: [
      { bind: "tab", title: "次の項目", run: () => setFocus((value) => (value + 1) % (actions().length + 2)) },
      {
        bind: "shift+tab",
        title: "前の項目",
        run: () => setFocus((value) => (value + actions().length + 1) % (actions().length + 2)),
      },
      {
        bind: "up",
        title: "上のエージェント",
        enabled: focus() === 0,
        run: () => setPosition((value) => Math.max(0, value - 1)),
      },
      {
        bind: "down",
        title: "下のエージェント",
        enabled: focus() === 0,
        run: () => setPosition((value) => Math.max(0, Math.min(options().length - 1, value + 1))),
      },
      {
        bind: "space",
        title: "接続を切り替え",
        enabled: focus() === 0,
        run: () => {
          const member = options()[position()]
          if (member) toggleMember(member.id)
        },
      },
      { bind: "return", title: "選択", enabled: focus() >= 2, run: () => act(focus() - 2) },
      { bind: "ctrl+return", title: "保存", run: () => void save() },
      { bind: "escape", title: "閉じる", run: () => dialog.clear() },
    ],
  }))
  onMount(() => dialog.setSize("large"))
  createEffect(() => {
    editor()?.blur()
    if (focus() === 1 && !busy()) editor()?.focus()
  })
  return (
    <box paddingLeft={2} paddingRight={2} paddingBottom={1} gap={1}>
      <text attributes={TextAttributes.BOLD} fg={theme.text.default}>
        メンバーの停止通知
      </text>
      <Show
        when={loaded()}
        fallback={
          <text fg={theme.text.feedback.error.default}>{loaded.error ? String(loaded.error) : "読み込み中…"}</text>
        }
      >
        <text fg={theme.text.default}>
          通知先: {loaded()?.sessions.find((session) => session.id === props.sessionID)?.title ?? props.sessionID}
        </text>
        <text fg={theme.text.default}>状態: {enabled() ? "有効" : "一時停止中"}</text>
        <box>
          <text fg={theme.text.default}>接続するエージェント（{members().length}人）</text>
          <For each={options().slice(offset(), offset() + 8)}>
            {(session, index) => (
              <text
                fg={
                  focus() === 0 && position() === offset() + index()
                    ? theme.text.formfield.focused
                    : theme.text.formfield.default
                }
                onMouseDown={() => {
                  setFocus(0)
                  setPosition(offset() + index())
                  toggleMember(session.id)
                }}
              >
                {position() === offset() + index() && focus() === 0 ? ">" : " "} [
                {members().includes(session.id) ? "✓" : " "}] {session.title ?? session.id}
              </text>
            )}
          </For>
          <Show when={options().length === 0}>
            <text fg={theme.text.subdued}>接続できるエージェントがありません。</text>
          </Show>
        </box>
        <text fg={theme.text.default}>通知文 · {"{member}"} はメンバー名に置き換えます</text>
        <textarea
          ref={setEditor}
          initialValue={loaded()?.watch?.text ?? "{member} が止まりました"}
          height={4}
          wrapMode="word"
          textColor={theme.text.formfield.default}
          focusedTextColor={theme.text.formfield.focused}
          cursorColor={theme.text.formfield.focused}
          cursorStyle={config.cursor}
          onMouseDown={() => setFocus(1)}
        />
        <Show when={error()}>
          <text fg={theme.text.feedback.error.default}>{error()}</text>
        </Show>
        <box flexDirection="row" gap={1} flexWrap="wrap">
          <For each={actions()}>
            {(label, index) => (
              <box
                paddingLeft={1}
                paddingRight={1}
                backgroundColor={
                  focus() === index() + 2
                    ? theme.background.action[loaded()?.watch && index() === 2 ? "destructive" : "primary"].focused
                    : theme.background.action[loaded()?.watch && index() === 2 ? "destructive" : "primary"].default
                }
                onMouseUp={() => act(index())}
              >
                <text
                  fg={
                    focus() === index() + 2
                      ? theme.text.action[loaded()?.watch && index() === 2 ? "destructive" : "primary"].focused
                      : theme.text.action[loaded()?.watch && index() === 2 ? "destructive" : "primary"].default
                  }
                >
                  {busy() && index() === 0 ? "保存中…" : label}
                </text>
              </box>
            )}
          </For>
        </box>
        <text fg={theme.text.subdued}>
          ↑↓ 移動 · Space 選択 · Tab 項目移動 · Alt+Enter 改行 · Ctrl+Enter 保存 · Esc 閉じる
        </text>
      </Show>
    </box>
  )
}
