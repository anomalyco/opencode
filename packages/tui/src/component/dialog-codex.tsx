import { Schema } from "effect"
import { createResource, createSignal } from "solid-js"
import path from "node:path"
import { Agent } from "@opencode/schema/agent"
import { Model } from "@opencode/schema/model"
import { Provider } from "@opencode/schema/provider"
import { SessionTransfer } from "@opencode/schema/session-transfer"
import type { SessionImportInput } from "@opencode/client/promise"
import { useClient } from "../context/client"
import { useData } from "../context/data"
import { useLocal } from "../context/local"
import { useRoute } from "../context/route"
import { useTuiPaths } from "../context/runtime"
import { useDialog } from "../ui/dialog"
import { DialogSelect } from "../ui/dialog-select"
import { useToast } from "../ui/toast"
import { codexList, codexTransfer, type CodexThread } from "../util/codex"
import { Locale } from "../util/locale"
import { errorMessage } from "../util/error"

export function DialogCodex(props: { home?: string } = {}) {
  const paths = useTuiPaths()
  const dialog = useDialog()
  const home = props.home ?? process.env.CODEX_HOME ?? path.join(paths.home, ".codex")
  const [threads] = createResource(() =>
    codexList(home).then(
      (threads) => ({ threads, error: undefined }),
      (error: unknown) => ({ threads: [], error: errorMessage(error) }),
    ),
  )
  return (
    <DialogSelect
      title="Codexのセッションを開く"
      placeholder="タイトルで検索"
      options={(threads()?.threads ?? []).map((thread) => ({
        title: thread.title || "Untitled",
        value: thread,
        description: thread.cwd,
        footer: Locale.datetime(thread.updated),
      }))}
      emptyView={
        <text>{threads.loading ? "読み込み中…" : (threads()?.error ?? "Codexのセッションがありません。")}</text>
      }
      onSelect={(option) => dialog.replace(() => <DialogCodexImport home={home} thread={option.value} />)}
    />
  )
}

function DialogCodexImport(props: { home: string; thread: CodexThread }) {
  const client = useClient()
  const data = useData()
  const local = useLocal()
  const route = useRoute()
  const dialog = useDialog()
  const toast = useToast()
  const [busy, setBusy] = createSignal(false)
  async function importSession() {
    if (busy()) return
    setBusy(true)
    const model = local.model.selection()
    const agent = local.agent.current()
    if (!model || !agent) {
      toast.error(new Error("先にモデルとエージェントを選択してください。"))
      setBusy(false)
      return
    }
    await codexTransfer(props.home, props.thread, {
      agent: Agent.ID.make(agent.id),
      model: Model.Ref.make({
        providerID: Provider.ID.make(model.providerID),
        id: Model.ID.make(model.modelID),
        ...(model.variant ? { variant: Model.VariantID.make(model.variant) } : {}),
      }),
    })
      .then(async (transfer) => {
        // Schema's JSON arrays are readonly; generated client JSON arrays are mutable.
        const input = {
          ...Schema.encodeSync(SessionTransfer.Data)(transfer),
          location: { directory: props.thread.cwd },
        } as SessionImportInput
        const imported = await client.api.session.import(input)
        await data.session.sync(imported.id)
        route.navigate({ type: "session", sessionID: imported.id })
        dialog.clear()
      })
      .catch(toast.error)
      .finally(() => setBusy(false))
  }
  return (
    <DialogSelect
      title="Codexから取り込む"
      titleView={
        <box gap={1}>
          <text>Codexから取り込む</text>
          <text>{props.thread.title}</text>
          <text>作業ディレクトリ: {props.thread.cwd}</text>
          <text>使用モデル: {local.model.current()?.modelID ?? "未選択"}</text>
        </box>
      }
      renderFilter={false}
      locked={busy()}
      options={[{ title: busy() ? "取り込み中…" : "取り込んで開く", value: "import" }]}
      onSelect={() => void importSession()}
      bindings={[
        { bind: "return", title: "取り込んで開く", run: () => void importSession() },
        { bind: "escape", title: "戻る", run: () => dialog.replace(() => <DialogCodex home={props.home} />) },
      ]}
    />
  )
}
