import { createMemo, createSignal, onCleanup, onMount } from "solid-js"
import { useDialog } from "@tui/ui/dialog"
import { useSync } from "@tui/context/sync"
import { useSDK } from "@tui/context/sdk"
import { useToast } from "@tui/ui/toast"
import { DialogSelect } from "@tui/ui/dialog-select"
import { createClient, createConfig } from "@/local/llama-skein/gen/client"
import { LlamaSkeinClient } from "@/local/llama-skein/gen/sdk.gen"
import type { ResourceSnapshot } from "@/local/llama-skein/gen/types.gen"

const MIN_WORKFLOW_CTX = 65536
const MAX_CTX = 262144

// Compute the optimal ctx_size from actual hardware data.
// kv_estimate_mb is the KV pre-allocated for the full current ctx_size.
// freeMb is genuinely available VRAM as reported by the GPU driver (already
// excludes driver/OS overhead — no artificial reserve needed).
// Total KV budget = kvEstMb (already allocated) + freeMb (available to expand into).
function computeRecommendedCtx(m: MemSnapshot, currentCtx: number): number | null {
  if (m.kvEstMb <= 0 || currentCtx <= 0) return null
  const kvBudgetMb = m.kvEstMb + m.freeMb
  const tokens = Math.floor(kvBudgetMb * currentCtx / m.kvEstMb)
  const rounded = Math.floor(tokens / 4096) * 4096
  return Math.max(MIN_WORKFLOW_CTX, Math.min(MAX_CTX, rounded))
}

const PRESETS = [
  4096, 8192, 12288, 16384, 20480, 24576, 28672, 32768,
  36864, 40960, 49152, 57344, 65536,
  73728, 81920, 98304, 114688, 131072,
  163840, 196608, 262144, 393216, 524288, 786432, 1048576,
]

function fmtCtxK(n: number): string {
  if (n >= 1024 && n % 1024 === 0) return `${n / 1024}k`
  if (n >= 1000) return `${Math.round(n / 1024)}k`
  return `${n}`
}

function fmtGB(mb: number): string {
  return (mb / 1024).toFixed(1)
}

type MemSnapshot = {
  freeMb: number
  totalMb: number
  usedMb: number
  label: string
  modelMb: number    // model weights (from file size); 0 if unknown
  kvEstMb: number    // kv cache estimate; 0 if unknown
}

function extractMem(hw: ResourceSnapshot): MemSnapshot | null {
  const modelMb = hw.loaded_model?.model_mb ?? 0
  const kvEstMb = hw.loaded_model?.kv_estimate_mb ?? 0

  if (hw.vram?.total_mb && hw.vram.total_mb > 100) {
    return { freeMb: hw.vram.free_mb ?? 0, usedMb: hw.vram.used_mb ?? 0, totalMb: hw.vram.total_mb, label: "VRAM", modelMb, kvEstMb }
  }
  if (hw.memory?.total_mb) {
    return {
      freeMb: hw.memory.free_mb ?? 0,
      usedMb: hw.memory.used_mb ?? 0,
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

export function DialogModelCtx(props: { providerID: string; modelID: string }) {
  const dialog = useDialog()
  const sync = useSync()
  const sdk = useSDK()
  const toast = useToast()
  const [busy, setBusy] = createSignal(false)
  const [mem, setMem] = createSignal<MemSnapshot | null>(null)

  const provider = createMemo(() => sync.data.provider.find((p) => p.id === props.providerID))

  const current = createMemo(() => provider()?.models[props.modelID]?.limit.context ?? 0)

  const modelName = createMemo(() => provider()?.models[props.modelID]?.name ?? props.modelID)

  onMount(() => {
    const baseURL = provider()?.options?.["baseURL"] as string | undefined
    if (!baseURL) return
    const llamaClient = new LlamaSkeinClient({
      client: createClient(createConfig({ baseUrl: normalizeBaseURL(baseURL) })),
    })
    const poll = async () => {
      try {
        const res = await llamaClient.getHardware()
        if (res.data) setMem(extractMem(res.data))
      } catch {
        // backend may not support /api/hardware — ignore silently
      }
    }
    poll()
    const id = setInterval(poll, 15_000)
    onCleanup(() => clearInterval(id))
  })

  const recommended = createMemo(() => {
    const m = mem()
    const cur = current()
    if (!m || cur <= 0) return null
    return computeRecommendedCtx(m, cur)
  })

  const options = createMemo(() => {
    const cur = current()
    const m = mem()
    const rec = recommended()
    const kvPerToken = m && cur > 0 && m.kvEstMb > 0 ? m.kvEstMb / cur : null
    const extra = new Set(cur > 0 ? [cur] : [])
    if (rec) extra.add(rec)
    const sizes = [...new Set([...PRESETS, ...extra])].sort((a, b) => a - b)
    return sizes.map((n) => {
      let description: string | undefined
      if (n === cur && n === rec) {
        description = "current · recommended"
      } else if (n === cur) {
        description = "current"
      } else if (n === rec) {
        description = "recommended for this model + VRAM"
      } else if (n < MIN_WORKFLOW_CTX) {
        description = "⚠ too small — MCP tools fill this before meaningful work"
      } else if (n > cur && m && kvPerToken) {
        const extraKvMb = (n - cur) * kvPerToken
        description = `+${fmtCtxK(n - cur)}`
        if (extraKvMb > m.freeMb) {
          description += ` · ⚠ exceeds free ${m.label} (${fmtGB(m.freeMb)} GB)`
        }
      }
      return { value: n, title: fmtCtxK(n), description, highlight: n === cur || n === rec }
    })
  })

  const titleSuffix = createMemo(() => {
    const m = mem()
    if (!m) return ""
    return ` · ${fmtGB(m.freeMb)}/${fmtGB(m.totalMb)} GB ${m.label} free`
  })

  async function apply(ctx_size: number) {
    if (busy()) return
    setBusy(true)
    try {
      const res = await sdk.client.local.model.setCtxSize(
        {
          providerID: props.providerID,
          modelID: props.modelID,
          directory: sdk.directory,
          localCtxSizePayload: { ctx_size },
        },
        { throwOnError: true },
      )
      if (res.data === false) {
        toast.show({ variant: "error", message: "Provider not found or has no base URL" })
        return
      }
      await sync.refreshProviders()
      toast.show({ variant: "info", message: `Context set to ${fmtCtxK(ctx_size)}` })
      dialog.clear()
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      toast.show({ variant: "error", message: `Failed to set context size: ${msg}` })
    } finally {
      setBusy(false)
    }
  }

  return (
    <DialogSelect<number>
      title={`Context — ${modelName()}${titleSuffix()}`}
      options={options()}
      flat={true}
      skipFilter={true}
      current={current()}
      onSelect={(opt) => apply(opt.value)}
    />
  )
}
