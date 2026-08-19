import { createMemo, createResource, createSignal } from "solid-js"
import { useDialog } from "../ui/dialog"
import { useSync } from "../context/sync"
import { useSDK } from "../context/sdk"
import { useToast } from "../ui/toast"
import { DialogSelect } from "../ui/dialog-select"
import { createClient, createConfig } from "../local/llama-skein/gen/client"
import { LlamaSkeinClient } from "../local/llama-skein/gen/sdk.gen"
import type { TuningStatus } from "../local/llama-skein/gen/types.gen"
import { normalizeBaseURL } from "../local/model-fit"

// Tri-state a user override can hold: defer to the recommended profile value,
// or force on/off. Cycles recommended → on → off → recommended.
type Tri = "recommended" | "on" | "off"

function cycleTri(t: Tri): Tri {
  return t === "recommended" ? "on" : t === "on" ? "off" : "recommended"
}
function triToPatch(t: Tri): boolean | undefined {
  return t === "recommended" ? undefined : t === "on"
}
function triLabel(t: Tri, recommended: boolean | undefined): string {
  if (t === "recommended") return `recommended${recommended === undefined ? "" : recommended ? " (on)" : " (off)"}`
  return t
}

type Row =
  | { kind: "enabled" }
  | { kind: "flash_attn" }
  | { kind: "mtp" }
  | { kind: "parallel" }
  | { kind: "apply" }
  | { kind: "reset" }
  | { kind: "info" }

const PARALLEL_CYCLE = [1, 2, 4, 8]

export function DialogTuning(props: { providerID: string }) {
  const dialog = useDialog()
  const sync = useSync()
  const sdk = useSDK()
  const toast = useToast()

  const provider = createMemo(() => sync.data.provider.find((p) => p.id === props.providerID))
  const baseURL = createMemo(() => provider()?.options?.["baseURL"] as string | undefined)

  const client = createMemo(() => {
    const url = baseURL()
    if (!url) return null
    return new LlamaSkeinClient({ client: createClient(createConfig({ baseUrl: normalizeBaseURL(url) })) })
  })

  const [status] = createResource(async () => {
    const c = client()
    if (!c) return null
    const res = await c.getTuning().catch(() => null)
    return (res?.data as TuningStatus | undefined) ?? null
  })

  // Local edit state: tri-states default to "recommended" (no override).
  const [enabled, setEnabled] = createSignal<boolean | undefined>(undefined)
  const [flashAttn, setFlashAttn] = createSignal<Tri>("recommended")
  const [mtp, setMtp] = createSignal<Tri>("recommended")
  const [parallel, setParallel] = createSignal<number | undefined>(undefined)

  const recFlash = createMemo(() => status()?.profile?.flags?.flash_attn)
  const recMtp = createMemo(() => status()?.profile?.mtp?.apply_to_mtp_models)
  const recParallel = createMemo(() => status()?.profile?.flags?.parallel)
  const verified = createMemo(() => status()?.profile?.verified === true)
  const gfx = createMemo(() => status()?.detected_gfx ?? "unknown")

  const options = createMemo(() => {
    const st = status()
    const rows: Array<{ value: Row; title: string; description?: string; disabled?: boolean }> = []

    rows.push({
      value: { kind: "info" },
      title: `GPU: ${gfx()}${verified() ? "  ✓ verified profile" : "  · unverified (conservative)"}`,
      description: st?.profile?.notes ?? "no profile for this GPU",
      disabled: true,
    })

    const en = enabled()
    rows.push({
      value: { kind: "enabled" },
      title: `Auto-tune: ${en === undefined ? "recommended (on)" : en ? "on" : "off"}`,
      description: "master switch — off launches the model command verbatim",
    })

    rows.push({
      value: { kind: "flash_attn" },
      title: `Flash attention: ${triLabel(flashAttn(), recFlash())}`,
      description: "select to cycle recommended → on → off",
    })

    rows.push({
      value: { kind: "parallel" },
      title: `Parallel slots: ${parallel() === undefined ? `recommended (${recParallel() ?? "unset"})` : parallel()}`,
      description: "one request at a time = 1; select to cycle 1/2/4/8",
    })

    rows.push({
      value: { kind: "mtp" },
      title: `MTP speculative: ${triLabel(mtp(), recMtp())}`,
      description: verified()
        ? "select to cycle recommended → on → off"
        : "⚠ unverified on this GPU — enable at your own risk",
    })

    if (st?.profile?.flags || st?.extra_args) {
      const eff: string[] = []
      if (st?.profile?.flags?.flash_attn !== undefined) eff.push(`--flash-attn ${st.profile.flags.flash_attn ? "on" : "off"}`)
      if (st?.profile?.flags?.parallel !== undefined) eff.push(`--parallel ${st.profile.flags.parallel}`)
      if (st?.profile?.mtp?.apply_to_mtp_models) eff.push("--spec-type draft-mtp (MTP models)")
      if (st?.extra_args?.length) eff.push(...st.extra_args)
      rows.push({
        value: { kind: "info" },
        title: `Effective: ${eff.join(" ") || "(none)"}`,
        description: "applied to llamacpp model launches; explicit cmd flags always win",
        disabled: true,
      })
    }

    rows.push({ value: { kind: "apply" }, title: "✓ Apply", description: "save override + reload affected models" })
    rows.push({ value: { kind: "reset" }, title: "↺ Reset to recommended", description: "clear all overrides on this host" })
    return rows
  })

  function apply() {
    const c = client()
    if (!c) {
      toast.show({ variant: "error", message: "Provider has no base URL" })
      return
    }
    const tuningPatchRequest: Record<string, unknown> = {}
    if (enabled() !== undefined) tuningPatchRequest.enabled = enabled()
    const fa = triToPatch(flashAttn())
    if (fa !== undefined) tuningPatchRequest.flash_attn = fa
    const m = triToPatch(mtp())
    if (m !== undefined) tuningPatchRequest.mtp = m
    if (parallel() !== undefined) tuningPatchRequest.parallel = parallel()

    dialog.clear()
    toast.show({ variant: "info", message: "Tuning saved — reloading affected models…" })
    c.patchTuning({ tuningPatchRequest })
      .then(() => void sync.refreshProviders())
      .catch((e: unknown) => {
        const msg = e instanceof Error ? e.message : String(e)
        toast.show({ variant: "error", message: `Failed to update tuning: ${msg}` })
      })
  }

  function reset() {
    const c = client()
    if (!c) return
    dialog.clear()
    toast.show({ variant: "info", message: "Tuning reset to recommended — reloading…" })
    c.patchTuning({ tuningPatchRequest: {} })
      .then(() => void sync.refreshProviders())
      .catch((e: unknown) => {
        const msg = e instanceof Error ? e.message : String(e)
        toast.show({ variant: "error", message: `Failed to reset tuning: ${msg}` })
      })
  }

  return (
    <DialogSelect<Row>
      title={`GPU tuning — ${provider()?.name ?? props.providerID}`}
      options={options()}
      skipFilter={true}
      emptyView={<text>Tuning unavailable for this provider</text>}
      onSelect={(opt) => {
        switch (opt.value.kind) {
          case "enabled":
            setEnabled((e) => (e === undefined ? true : e ? false : undefined))
            break
          case "flash_attn":
            setFlashAttn(cycleTri)
            break
          case "mtp":
            setMtp(cycleTri)
            break
          case "parallel":
            setParallel((p) => {
              if (p === undefined) return PARALLEL_CYCLE[0]
              const i = PARALLEL_CYCLE.indexOf(p)
              return i < 0 || i === PARALLEL_CYCLE.length - 1 ? undefined : PARALLEL_CYCLE[i + 1]
            })
            break
          case "apply":
            apply()
            break
          case "reset":
            reset()
            break
          case "info":
            break
        }
      }}
    />
  )
}
