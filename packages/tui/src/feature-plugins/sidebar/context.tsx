import type { AssistantMessage } from "@opencode-ai/sdk/v2"
import type { TuiPlugin, TuiPluginApi } from "@opencode-ai/plugin/tui"
import type { BuiltinTuiPlugin } from "../builtins"
import { createEffect, createMemo, createSignal, For, on, onCleanup, Show } from "solid-js"
import { DialogModelCtx } from "../../component/dialog-model-ctx"
import { createClient, createConfig } from "@/local/llama-skein/gen/client"
import { LlamaSkeinClient } from "@/local/llama-skein/gen/sdk.gen"
import type { ResourceSnapshot } from "@/local/llama-skein/gen/types.gen"
import { TextAttributes } from "@opentui/core"

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

type MemSnapshot = {
  usedMb: number
  totalMb: number
  freeMb: number
  label: string
  modelMb: number
  kvEstMb: number
}

type Seg = { chars: number; color: string; filled: boolean }

function extractMem(hw: ResourceSnapshot): MemSnapshot | null {
  const modelMb = hw.loaded_model?.model_mb ?? 0
  const kvEstMb = hw.loaded_model?.kv_estimate_mb ?? 0
  if (hw.vram?.total_mb && hw.vram.total_mb > 100) {
    return { usedMb: hw.vram.used_mb ?? 0, freeMb: hw.vram.free_mb ?? 0, totalMb: hw.vram.total_mb, label: "VRAM", modelMb, kvEstMb }
  }
  if (hw.memory?.total_mb) {
    return {
      usedMb: hw.memory.used_mb ?? 0,
      freeMb: hw.memory.free_mb ?? 0,
      totalMb: hw.memory.total_mb,
      label: hw.memory.type === "unified" ? "Unified" : "RAM",
      modelMb,
      kvEstMb,
    }
  }
  return null
}

function normalizeBaseURL(url: string): string {
  return url.replace(/\/+$/, "").replace(/\/v1$/, "")
}

function Bar(props: { segs: Seg[]; percent?: number | null; theme: any; onClick?: () => void }) {
  const t = props.theme
  return (
    <text onMouseUp={props.onClick}>
      <For each={props.segs}>
        {(s) => <span style={{ fg: s.color }}>{(s.filled ? "▓" : "░").repeat(Math.max(0, s.chars))}</span>}
      </For>
      <Show when={props.percent != null}>
        {"  "}<span style={{ fg: t.textMuted }}>{props.percent}%</span>
      </Show>
    </text>
  )
}

function emptySegs(t: any): Seg[] {
  return [{ chars: BAR_WIDTH, color: t.textMuted, filled: false }]
}

function tokenSegs(percent: number, t: any): Seg[] {
  const used = Math.max(1, Math.min(BAR_WIDTH, Math.round((percent / 100) * BAR_WIDTH)))
  return [
    { chars: used, color: t.accent, filled: true },
    { chars: BAR_WIDTH - used, color: t.textMuted, filled: false },
  ]
}

function vramSegs(m: MemSnapshot, tokenPercent: number | null, t: any): Seg[] {
  const total = m.totalMb || 1
  if (m.modelMb > 0) {
    const modelChars = Math.max(1, Math.round((m.modelMb / total) * BAR_WIDTH))
    const remaining = BAR_WIDTH - modelChars
    const ctxTotalChars = Math.max(0, Math.min(remaining, Math.round((m.kvEstMb / total) * BAR_WIDTH)))
    const freeChars = Math.max(0, remaining - ctxTotalChars)
    if (tokenPercent !== null && ctxTotalChars > 0) {
      const ctxActiveChars = Math.max(0, Math.min(ctxTotalChars, Math.round((tokenPercent / 100) * ctxTotalChars)))
      const ctxHeadroomChars = ctxTotalChars - ctxActiveChars
      return [
        { chars: modelChars, color: t.warning, filled: true },
        { chars: ctxActiveChars, color: t.accent, filled: true },
        { chars: ctxHeadroomChars, color: t.accent, filled: false },
        { chars: freeChars, color: t.textMuted, filled: false },
      ]
    }
    return [
      { chars: modelChars, color: t.warning, filled: true },
      { chars: ctxTotalChars, color: t.accent, filled: true },
      { chars: freeChars, color: t.textMuted, filled: false },
    ]
  }
  const usedChars = Math.max(1, Math.min(BAR_WIDTH, Math.round((m.usedMb / total) * BAR_WIDTH)))
  return [
    { chars: usedChars, color: t.warning, filled: true },
    { chars: BAR_WIDTH - usedChars, color: t.textMuted, filled: false },
  ]
}

function MemBreakdown(props: { mem: MemSnapshot; theme: any }) {
  const m = props.mem
  const t = props.theme
  const total = `${fmtGB(m.totalMb)} GB`
  if (m.modelMb > 0) {
    return (
      <text fg={t.textMuted}>
        <span style={{ fg: t.warning }}>mod</span>{" "}{fmtGB(m.modelMb)}
        {" + "}
        <span style={{ fg: t.accent }}>ctx</span>{" "}{fmtGB(m.kvEstMb)}
        {" / "}{total}
      </text>
    )
  }
  return <text fg={t.textMuted}>{fmtGB(m.usedMb)} / {total}</text>
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
    return {
      tokens,
      percent: ctx > 0 && tokens > 0 ? Math.round((tokens / ctx) * 100) : null,
      ctxWindow: ctx > 0 ? fmtCtxK(ctx) : null,
      tokensPerSecond,
      isLocal,
      providerID: providerID ?? null,
      modelID: modelID ?? null,
      baseURL: baseURL ?? null,
    }
  })

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
      const pollId = setInterval(poll, 30_000)
      onCleanup(() => clearInterval(pollId))
    },
  ))

  function openCtxDialog() {
    const { providerID, modelID } = state()
    if (!providerID || !modelID) return
    props.api.ui.dialog.replace(() => <DialogModelCtx providerID={providerID} modelID={modelID} />)
  }

  const canOpenDialog = () => state().isLocal && Boolean(state().ctxWindow)
  const clickProps = () => canOpenDialog() ? { onMouseUp: openCtxDialog } : {}

  return (
    <box>
      {/* ── Context ── */}
      <text fg={theme().text} attributes={TextAttributes.BOLD} {...clickProps()}>Context</text>
      <Bar
        segs={state().percent !== null ? tokenSegs(state().percent!, theme()) : emptySegs(theme())}
        percent={state().percent}
        theme={theme()}
        onClick={canOpenDialog() ? openCtxDialog : undefined}
      />
      <Show when={state().percent !== null}>
        <text fg={theme().textMuted} {...clickProps()}>
          {state().tokens.toLocaleString()}
          {" / "}
          <span style={{ fg: canOpenDialog() ? theme().accent : theme().textMuted }}>
            {state().ctxWindow}
          </span>
        </text>
      </Show>

      {/* ── VRAM (local) or Cost (cloud) ── */}
      <Show
        when={state().isLocal}
        fallback={
          <>
            <text fg={theme().text} attributes={TextAttributes.BOLD}>Cost</text>
            <text fg={theme().textMuted}>{money.format(cost())} spent</text>
          </>
        }
      >
        <Show when={mem()}>
          {(m) => (
            <>
              <text fg={theme().text} attributes={TextAttributes.BOLD}>{m().label}</text>
              <Bar
                segs={vramSegs(m(), state().percent, theme())}
                percent={Math.round((m().usedMb / (m().totalMb || 1)) * 100)}
                theme={theme()}
              />
              <MemBreakdown mem={m()} theme={theme()} />
            </>
          )}
        </Show>
      </Show>

      {/* ── Speed ── */}
      <Show when={state().tokensPerSecond !== null}>
        <text fg={theme().textMuted}>{fmtTokensPerSecond(state().tokensPerSecond!)} t/s</text>
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

const plugin: BuiltinTuiPlugin = {
  id,
  tui,
}

export default plugin
