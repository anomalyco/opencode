import { InputRenderable, TextareaRenderable, TextAttributes } from "@opentui/core"
import type { SessionScheduleInfo } from "@opencode/client"
import { createEffect, createResource, createSignal, For, onCleanup, onMount, Show } from "solid-js"
import { useClient } from "../context/client"
import { Keymap } from "../context/keymap"
import { useTheme } from "../context/theme"
import { useConfig } from "../config"
import { useDialog } from "../ui/dialog"
import { DialogSelect } from "../ui/dialog-select"
import { useToast } from "../ui/toast"

export function DialogSchedule(props: { sessionID: string }) {
  const client = useClient()
  const dialog = useDialog()
  const toast = useToast()
  const theme = useTheme()
  const [selected, setSelected] = createSignal<SessionScheduleInfo>()
  const [deleting, setDeleting] = createSignal<string>()
  const [busy, setBusy] = createSignal(false)
  const [entries, { refetch }] = createResource(async () =>
    client.api.session.scheduleList({ sessionID: props.sessionID }).catch((error) => {
      toast.error(error)
      return []
    }),
  )
  const timer = setInterval(() => void refetch(), 5_000)
  onCleanup(() => clearInterval(timer))
  onMount(() => dialog.setSize("large"))
  const current = () => entries()?.find((entry) => entry.id === selected()?.id) ?? entries()?.[0]
  const back = () => dialog.replace(() => <DialogSchedule sessionID={props.sessionID} />)
  const edit = (entry?: SessionScheduleInfo) =>
    dialog.replace(() => <ScheduleForm sessionID={props.sessionID} entry={entry} onSaved={back} onCancel={back} />)
  async function toggle() {
    const entry = current()
    if (!entry || busy()) return
    setBusy(true)
    await client.api.session
      .scheduleUpdate({ ...entry, scheduleID: entry.id, enabled: !entry.enabled })
      .then(() => refetch())
      .catch(toast.error)
      .finally(() => setBusy(false))
  }
  async function remove() {
    const entry = current()
    if (!entry || busy()) return
    if (deleting() !== entry.id) {
      setDeleting(entry.id)
      return
    }
    setBusy(true)
    await client.api.session
      .scheduleRemove({ sessionID: props.sessionID, scheduleID: entry.id })
      .then(() => {
        setDeleting(undefined)
        return refetch()
      })
      .catch(toast.error)
      .finally(() => setBusy(false))
  }
  return (
    <DialogSelect
      title="定期送信"
      skipFilter
      renderFilter={false}
      preserveSelection
      locked={busy()}
      options={(entries() ?? []).map((entry) => ({
        title: deleting() === entry.id ? "もう一度 d を押すと削除します" : entry.text.trim().split("\n")[0],
        details: [
          `${entry.intervalMinutes}分おき · ${entry.enabled ? "実行中" : "停止中"}${entry.nextAt === null ? "" : ` · 次回 ${new Date(entry.nextAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false })}`}`,
        ],
        value: entry,
        fg: deleting() === entry.id ? theme.text.action.destructive.base : undefined,
      }))}
      onMove={(option) => {
        setSelected(option.value)
        setDeleting(undefined)
      }}
      onSelect={(option) => edit(option.value)}
      emptyView={
        <box paddingLeft={4}>
          <text fg={theme.text.muted}>
            {entries.loading ? "読み込み中…" : "定期送信はありません。n で追加できます。"}
          </text>
        </box>
      }
      footerHints={[
        { title: "Enter", label: "編集" },
        { title: "n", label: "追加" },
        { title: "Space", label: "停止／再開" },
        { title: "d", label: "削除" },
      ]}
      bindings={[
        { bind: "n", title: "定期送信を追加", run: () => edit(), enabled: !busy() },
        { bind: "space", title: "停止／再開", run: () => void toggle(), enabled: !busy() },
        { bind: "d", title: "定期送信を削除", run: () => void remove(), enabled: !busy() },
      ]}
    />
  )
}

function ScheduleForm(props: {
  sessionID: string
  entry?: SessionScheduleInfo
  onSaved: () => void
  onCancel: () => void
}) {
  const client = useClient()
  const dialog = useDialog()
  const toast = useToast()
  const theme = useTheme()
  const config = useConfig().data
  const [focus, setFocus] = createSignal(0)
  const [busy, setBusy] = createSignal(false)
  const [error, setError] = createSignal("")
  const [text, setText] = createSignal<TextareaRenderable>()
  const [interval, setInterval] = createSignal<InputRenderable>()
  const target = () => (focus() === 0 ? text() : focus() === 1 ? interval() : undefined)
  async function save() {
    if (busy()) return
    const value = text()?.plainText ?? ""
    const minutes = Number(interval()?.value)
    if (!value.trim() || !Number.isSafeInteger(minutes) || minutes < 1) {
      setError("文章と、1以上の整数の送信間隔を入力してください。")
      return
    }
    setError("")
    setBusy(true)
    const input = {
      sessionID: props.sessionID,
      text: value,
      intervalMinutes: minutes,
      enabled: props.entry?.enabled ?? true,
    }
    await (
      props.entry
        ? client.api.session.scheduleUpdate({ ...input, scheduleID: props.entry.id })
        : client.api.session.scheduleCreate(input)
    )
      .then(props.onSaved)
      .catch(toast.error)
      .finally(() => setBusy(false))
  }
  Keymap.createLayer(() => ({
    mode: "modal",
    target,
    priority: 1,
    enabled: !busy(),
    commands: [
      { bind: "tab", title: "次の項目", run: () => setFocus((value) => (value + 1) % 4) },
      { bind: "shift+tab", title: "前の項目", run: () => setFocus((value) => (value + 3) % 4) },
      { bind: "ctrl+return", title: "保存", run: () => void save() },
      {
        bind: "return",
        title: "選択",
        enabled: focus() >= 2,
        run: () => (focus() === 2 ? void save() : props.onCancel()),
      },
      { bind: "escape", title: "一覧に戻る", run: props.onCancel },
    ],
  }))
  onMount(() => dialog.setSize("large"))
  createEffect(() => {
    const message = text()
    const minutes = interval()
    message?.blur()
    minutes?.blur()
    if (busy()) return
    target()?.focus()
  })
  return (
    <box paddingLeft={2} paddingRight={2} paddingBottom={1} gap={1}>
      <text attributes={TextAttributes.BOLD} fg={theme.text.base}>
        {props.entry ? "定期送信を編集" : "定期送信を追加"}
      </text>
      <text fg={theme.text.base}>送信する文章</text>
      <textarea
        ref={setText}
        initialValue={props.entry?.text ?? ""}
        height={5}
        wrapMode="word"
        placeholder="定期的に送信する文章"
        placeholderColor={theme.text.muted}
        textColor={theme.text.formfield.base}
        focusedTextColor={theme.text.formfield.focused}
        cursorColor={theme.text.formfield.focused}
        cursorStyle={config.cursor}
        onMouseDown={() => setFocus(0)}
      />
      <text fg={theme.text.base}>送信間隔（分）</text>
      <input
        ref={setInterval}
        value={String(props.entry?.intervalMinutes ?? 5)}
        width={12}
        textColor={theme.text.formfield.base}
        focusedTextColor={theme.text.formfield.focused}
        cursorColor={theme.text.formfield.focused}
        onMouseDown={() => setFocus(1)}
      />
      <Show when={error()}>
        <text fg={theme.text.feedback.error.base}>{error()}</text>
      </Show>
      <box flexDirection="row" gap={2}>
        <For each={[props.entry ? "保存" : "保存して開始", "キャンセル"]}>
          {(label, index) => (
            <box
              paddingLeft={1}
              paddingRight={1}
              backgroundColor={
                focus() === index() + 2
                  ? theme.background.action.primary.focused
                  : theme.background.action.primary.base
              }
              onMouseUp={() => {
                if (busy()) return
                if (index() === 0) void save()
                if (index() === 1) props.onCancel()
              }}
            >
              <text
                fg={focus() === index() + 2 ? theme.text.action.primary.focused : theme.text.action.primary.base}
              >
                {busy() && index() === 0 ? "保存中…" : label}
              </text>
            </box>
          )}
        </For>
      </box>
      <text fg={theme.text.muted}>Tab 項目移動 · Alt+Enter 改行 · Ctrl+Enter 保存 · Esc 戻る</text>
    </box>
  )
}
