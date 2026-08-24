import { createMemo, createSignal, onCleanup, onMount } from "solid-js"
import { useDialog } from "../ui/dialog"
import { useSync } from "../context/sync"
import { useSDK } from "../context/sdk"
import { useToast } from "../ui/toast"
import { DialogSelect } from "../ui/dialog-select"
import { createClient, createConfig } from "../local/llama-skein/gen/client"
import { LlamaSkeinClient } from "../local/llama-skein/gen/sdk.gen"
import type { ModelFit } from "../local/llama-skein/gen/types.gen"
import {
  aboveCeiling,
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
  const [fit, setFit] = createSignal<ModelFit | null>(null)

  const provider = createMemo(() => sync.data.provider.find((p) => p.id === props.providerID))

  // fork: the backend's *hard* n_ctx — the KV allocation every number here is
  // scaled against. `limit.context` is `max_safe_ctx`, a prompt budget that has
  // already had the output reserve and safety margin subtracted, so using it
  // skewed every recommendation. Prefer `/api/fit` `configured_ctx`; fall back to
  // `limit.contextMax`, which provider discovery also fills from `configured_ctx`.
  const current = createMemo(() => fit()?.configured_ctx ?? provider()?.models[props.modelID]?.limit.contextMax ?? 0)

  // Largest hard n_ctx this host can load, already capped at the model's TRAINED
  // context by llama-skein. 0 = unknown (non-llama-skein backend, VRAM unreadable).
  const maxFit = createMemo(() => fit()?.max_fit_ctx ?? 0)

  // True physical ceiling: no vramSafetyFrac/promptMarginFrac margin, the
  // actual OOM line. Selections are blocked against THIS, not maxFit — see
  // aboveCeiling's doc comment for why blocking on the conservative number
  // let this dialog recommend a value and then refuse that same value.
  const maxPhysical = createMemo(() => fit()?.max_physical_ctx ?? 0)

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
      try {
        const res = await llamaClient.getModelFit({ model: props.modelID })
        if (res.data) setFit(res.data)
      } catch {
        // backend may not support /api/fit — ceiling stays unknown, nothing is capped
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
    return computeRecommendedCtx(m, cur, maxFit())
  })

  const options = createMemo(() => {
    const cur = current()
    const m = mem()
    const rec = recommended()
    const physMax = maxPhysical()
    const kvPerToken = m && cur > 0 && m.kvEstMb > 0 ? m.kvEstMb / cur : null
    const extra = new Set(cur > 0 ? [cur] : [])
    if (rec) extra.add(rec)
    if (physMax > 0) extra.add(physMax)
    const sizes = [...new Set([...PRESETS, ...extra])].sort((a, b) => a - b)
    const ceiling = physMax
    return sizes.map((n) => {
      let description: string | undefined
      // fork: PRESETS is hand-authored and runs to 1M, so it offers sizes no
      // model can load — this is how `--ctx-size 98304` got written onto a
      // 32k-trained model. Annotate loudly instead of hiding the row (a model
      // already misconfigured above the ceiling needs its `current` row visible),
      // and refuse the selection in apply().
      if (aboveCeiling(n, ceiling)) {
        description = `⚠ above ceiling (${fmtCtxK(ceiling)}) — backend cannot load this`
        if (n === cur) description = `current · ${description}`
      } else if (n === cur && n === rec) {
        description = "current · recommended"
      } else if (n === cur) {
        description = "current"
      } else if (n === rec) {
        description = "recommended for this model + VRAM"
      } else if (n === physMax) {
        description = "physical max — no safety margin, expect ~100% VRAM"
      } else if (n < MIN_WORKFLOW_CTX) {
        description = "⚠ too small — MCP tools fill this before meaningful work"
      } else if (n > cur && m && kvPerToken) {
        const extraKvMb = (n - cur) * kvPerToken
        description = `+${fmtCtxK(n - cur)}`
        if (extraKvMb > m.freeMb) {
          description += ` · ⚠ exceeds free ${m.label} (${fmtGB(m.freeMb)} GB)`
        }
      }
      return { value: n, title: fmtCtxK(n), description, highlight: n === cur || n === rec || n === physMax }
    })
  })

  const titleSuffix = createMemo(() => {
    const m = mem()
    const ceiling = maxPhysical()
    const safe = maxFit()
    const parts: string[] = []
    if (m) parts.push(`${fmtGB(m.freeMb)}/${fmtGB(m.totalMb)} GB ${m.label} free`)
    if (ceiling > 0) parts.push(`max ${fmtCtxK(ceiling)}`)
    if (safe > 0 && safe !== ceiling) parts.push(`safe ~${fmtCtxK(safe)}`)
    return parts.length ? ` · ${parts.join(" · ")}` : ""
  })

  function apply(ctx_size: number) {
    if (busy()) return
    const ceiling = maxPhysical()
    if (aboveCeiling(ctx_size, ceiling)) {
      // Refuse without closing so a valid size can still be picked. Server-side
      // this is enforced again in local.model.setCtxSize.
      toast.show({
        variant: "error",
        message: `${fmtCtxK(ctx_size)} exceeds what this model can load here (max ${fmtCtxK(ceiling)})`,
      })
      return
    }
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
          toast.show({
            variant: "error",
            message: "Context size rejected — provider has no base URL, or the size is above the model's ceiling",
          })
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
