import { createMemo, createSignal, onCleanup, onMount } from "solid-js"
import { useDialog } from "../ui/dialog"
import { useSync } from "../context/sync"
import { useSDK } from "../context/sdk"
import { useToast } from "../ui/toast"
import { DialogSelect } from "../ui/dialog-select"
import { createClient, createConfig } from "../local/llama-skein/gen/client"
import { LlamaSkeinClient } from "../local/llama-skein/gen/sdk.gen"
import {
  computeRecommendedCtx,
  extractMem,
  fmtCtxK,
  fmtGB,
  MIN_WORKFLOW_CTX,
  normalizeBaseURL,
  PRESETS,
  type MemSnapshot,
} from "../local/model-fit"

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

  function apply(ctx_size: number) {
    if (busy()) return
    setBusy(true)
    // Close immediately so the UI feels responsive; the model reload is slow.
    dialog.clear()
    toast.show({ variant: "info", message: `Context set to ${fmtCtxK(ctx_size)} — reloading model…` })
    sdk.client.local.model
      .setCtxSize(
        {
          providerID: props.providerID,
          modelID: props.modelID,
          directory: sdk.directory,
          localCtxSizePayload: { ctx_size },
        },
        { throwOnError: true },
      )
      .then((res) => {
        if (res.data === false) {
          toast.show({ variant: "error", message: "Provider not found or has no base URL" })
          return
        }
        void sync.refreshProviders()
      })
      .catch((e: unknown) => {
        const msg = e instanceof Error ? e.message : String(e)
        toast.show({ variant: "error", message: `Failed to set context size: ${msg}` })
      })
      .finally(() => {
        setBusy(false)
      })
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
