import { createMemo, createSignal, onCleanup, onMount } from "solid-js"
import { useDialog } from "@tui/ui/dialog"
import { useSync } from "@tui/context/sync"
import { useSDK } from "@tui/context/sdk"
import { useToast } from "@tui/ui/toast"
import { DialogSelect } from "@tui/ui/dialog-select"
import { createClient, createConfig } from "@/local/llama-skein/gen/client"
import { LlamaSkeinClient } from "@/local/llama-skein/gen/sdk.gen"
import type { ResourceSnapshot } from "@/local/llama-skein/gen/types.gen"

// Below this, MCP tools + system prompt fill the window before meaningful work starts.
const MIN_WORKFLOW_CTX = 65536

const PRESETS = [16384, 32768, 65536, 131072, 262144, 524288, 1048576]

function fmtCtxK(n: number): string {
  if (n >= 1024 && n % 1024 === 0) return `${n / 1024}k`
  if (n >= 1000) return `${Math.round(n / 1024)}k`
  return `${n}`
}

function fmtGB(mb: number): string {
  return (mb / 1024).toFixed(1)
}

type MemSnapshot = { freeMb: number; totalMb: number; usedMb: number; label: string }

function extractMem(hw: ResourceSnapshot): MemSnapshot | null {
  // Discrete GPU: use aggregate VRAM
  if (hw.vram?.total_mb && hw.vram.total_mb > 100) {
    return {
      freeMb: hw.vram.free_mb ?? 0,
      usedMb: hw.vram.used_mb ?? 0,
      totalMb: hw.vram.total_mb,
      label: "VRAM",
    }
  }
  // Apple Silicon unified memory or CPU-only
  if (hw.memory?.total_mb) {
    return {
      freeMb: hw.memory.free_mb ?? 0,
      usedMb: hw.memory.used_mb ?? 0,
      totalMb: hw.memory.total_mb,
      label: hw.memory.type === "unified" ? "Unified" : "RAM",
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

  const options = createMemo(() => {
    const cur = current()
    const m = mem()
    const sizes = [...new Set([...PRESETS, ...(cur > 0 ? [cur] : [])])].sort((a, b) => a - b)
    return sizes.map((n) => {
      let description: string | undefined
      if (n === cur) {
        description = "current"
      } else if (n < MIN_WORKFLOW_CTX) {
        description = "⚠ too small — MCP tools fill this before meaningful work"
      } else if (n === 131072) {
        description = "recommended — sweet spot for most MCP workflows"
      } else if (n > cur) {
        description = `+${fmtCtxK(n - cur)}`
        // Warn if free memory is known and expansion looks risky.
        // Rough heuristic: KV cache growth ≈ 4 MB per 1k extra tokens.
        if (m) {
          const extraKvMb = ((n - cur) / 1024) * 4
          if (extraKvMb > m.freeMb * 0.8) {
            description += ` · ⚠ low ${m.label} (${fmtGB(m.freeMb)} GB free)`
          }
        }
      }
      return { value: n, title: fmtCtxK(n), description, highlight: n === cur }
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
