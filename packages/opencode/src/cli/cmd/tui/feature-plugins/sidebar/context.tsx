import type { AssistantMessage } from "@opencode-ai/sdk/v2"
import type { TuiPlugin, TuiPluginApi } from "@opencode-ai/plugin/tui"
import type { InternalTuiPlugin } from "../../plugin/internal"
import { createEffect, createMemo, createSignal, on, onCleanup, Show } from "solid-js"
import { DialogModelCtx } from "../../component/dialog-model-ctx"
import { createClient, createConfig } from "@/local/llama-skein/gen/client"
import { LlamaSkeinClient } from "@/local/llama-skein/gen/sdk.gen"
import type { ResourceSnapshot } from "@/local/llama-skein/gen/types.gen"

const id = "internal:sidebar-context"

const BAR_WIDTH = 20

function fmtCtxK(n: number): string {
  if (n >= 1024 && n % 1024 === 0) return `${n / 1024}k`
  if (n >= 1000) return `${Math.round(n / 1024)}k`
  return `${n}`
}

function fmtTokensPerSecond(n: number): string {
  return n >= 10 ? Math.round(n).toLocaleString() : n.toFixed(1)
}

function fmtGB(mb: number): string {
  return (mb / 1024).toFixed(1)
}

const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" })

type MemSnapshot = { usedMb: number; totalMb: number; freeMb: number; label: string }

function extractMem(hw: ResourceSnapshot): MemSnapshot | null {
  if (hw.vram?.total_mb && hw.vram.total_mb > 100) {
    return { usedMb: hw.vram.used_mb ?? 0, freeMb: hw.vram.free_mb ?? 0, totalMb: hw.vram.total_mb, label: "VRAM" }
  }
  if (hw.memory?.total_mb) {
    return {
      usedMb: hw.memory.used_mb ?? 0,
      freeMb: hw.memory.free_mb ?? 0,
      totalMb: hw.memory.total_mb,
      label: hw.memory.type === "unified" ? "Unified" : "RAM",
    }
  }
  return null
}

function normalizeBaseURL(url: string): string {
  return url.replace(/\/+$/, "").replace(/\/v1$/, "")
}

function MemBar(props: { used: number; total: number; theme: any }) {
  const filled = Math.max(1, Math.min(BAR_WIDTH, Math.round((props.used / props.total) * BAR_WIDTH)))
  const empty = BAR_WIDTH - filled
  return (
    <text>
      <span style={{ fg: props.theme.warning }}>{"█".repeat(filled)}</span>
      <span style={{ fg: props.theme.textMuted }}>{"░".repeat(empty)}</span>
    </text>
  )
}

function View(props: { api: TuiPluginApi; session_id: string }) {
  const theme = () => props.api.theme.current
  const msg = createMemo(() => props.api.state.session.messages(props.session_id))
  const session = createMemo(() => props.api.state.session.get(props.session_id))
  const cost = createMemo(() => session()?.cost ?? 0)

  const [mem, setMem] = createSignal<MemSnapshot | null>(null)

  const state = createMemo(() => {
    const last = msg().findLast((item): item is AssistantMessage => item.role === "assistant" && item.tokens.output > 0)

    const tokens = last
      ? last.tokens.input + last.tokens.output + last.tokens.reasoning + last.tokens.cache.read + last.tokens.cache.write
      : 0

    const sessionModel = session()?.model
    const providerID = sessionModel?.providerID ?? last?.providerID
    const modelID = sessionModel?.id ?? last?.modelID
    const provider = providerID ? props.api.state.provider.find((item) => item.id === providerID) : undefined
    const model = provider && modelID ? provider.models[modelID] : undefined
    const ctx = model?.limit.context ?? 0
    const seconds = last?.time.completed ? Math.max(0, (last.time.completed - last.time.created) / 1000) : 0
    const tokensPerSecond = last && seconds > 0 && last.tokens.output > 0 ? last.tokens.output / seconds : null
    const isLocal = Boolean(provider?.options?.["baseURL"])
    const baseURL = (provider?.options?.["baseURL"]) as string | undefined
    return { tokens, percent: ctx > 0 && tokens > 0 ? Math.round((tokens / ctx) * 100) : null, ctxWindow: ctx > 0 ? fmtCtxK(ctx) : null, tokensPerSecond, isLocal, providerID: providerID ?? null, modelID: modelID ?? null, baseURL: baseURL ?? null }
  })

  // Poll /api/hardware when provider is a local llama-skein backend
  createEffect(on(
    () => state().baseURL,
    (url) => {
      if (!url) { setMem(null); return }
      const llamaClient = new LlamaSkeinClient({
        client: createClient(createConfig({ baseUrl: normalizeBaseURL(url) })),
      })
      const poll = async () => {
        try {
          const res = await llamaClient.getHardware()
          if (res.data) setMem(extractMem(res.data))
        } catch { /* backend may not support /api/hardware */ }
      }
      poll()
      const id = setInterval(poll, 30_000)
      onCleanup(() => clearInterval(id))
    },
  ))

  function openCtxDialog() {
    const { providerID, modelID } = state()
    if (!providerID || !modelID) return
    props.api.ui.dialog.replace(() => <DialogModelCtx providerID={providerID} modelID={modelID} />)
  }

  return (
    <box>
      <text fg={theme().text}>
        <b>Context</b>
      </text>
      <text
        fg={theme().textMuted}
        onMouseUp={state().isLocal && state().ctxWindow ? openCtxDialog : undefined}
      >
        {state().tokens.toLocaleString()}
        <Show when={state().ctxWindow}>
          {" / "}
          <span style={{ fg: state().isLocal ? theme().accent : theme().textMuted }}>
            {state().ctxWindow}
          </span>
        </Show>
        {" tokens"}
      </text>
      <Show when={state().percent !== null}>
        <text fg={theme().textMuted}>{state().percent}% used</text>
      </Show>
      <Show when={state().tokensPerSecond !== null}>
        <text fg={theme().textMuted}>{fmtTokensPerSecond(state().tokensPerSecond!)} tokens/s</text>
      </Show>
      <Show when={mem()}>
        {(m) => (
          <>
            <MemBar used={m().usedMb} total={m().totalMb} theme={theme()} />
            <text fg={theme().textMuted}>
              {fmtGB(m().usedMb)}/{fmtGB(m().totalMb)} GB {m().label}
              {" · "}
              <span style={{ fg: theme().accent }}>{fmtGB(m().freeMb)} free</span>
            </text>
          </>
        )}
      </Show>
      <Show when={!state().isLocal}>
        <text fg={theme().textMuted}>{money.format(cost())} spent</text>
      </Show>
    </box>
  )
}

const tui: TuiPlugin = async (api) => {
  api.slots.register({
    order: 100,
    slots: {
      sidebar_content(_ctx, props) {
        return <View api={api} session_id={props.session_id} />
      },
    },
  })
}

const plugin: InternalTuiPlugin = {
  id,
  tui,
}

export default plugin
