import { createMemo, createSignal } from "solid-js"
import { useDialog } from "@tui/ui/dialog"
import { useSync } from "@tui/context/sync"
import { useSDK } from "@tui/context/sdk"
import { useToast } from "@tui/ui/toast"
import { DialogSelect } from "@tui/ui/dialog-select"

const PRESETS = [4096, 8192, 16384, 32768, 65536, 131072, 262144, 524288, 1048576]

function fmtCtxK(n: number): string {
  if (n >= 1024 && n % 1024 === 0) return `${n / 1024}k`
  if (n >= 1000) return `${Math.round(n / 1024)}k`
  return `${n}`
}

export function DialogModelCtx(props: { providerID: string; modelID: string }) {
  const dialog = useDialog()
  const sync = useSync()
  const sdk = useSDK()
  const toast = useToast()
  const [busy, setBusy] = createSignal(false)

  const current = createMemo(() => {
    const provider = sync.data.provider.find((p) => p.id === props.providerID)
    return provider?.models[props.modelID]?.limit.context ?? 0
  })

  const modelName = createMemo(() => {
    const provider = sync.data.provider.find((p) => p.id === props.providerID)
    return provider?.models[props.modelID]?.name ?? props.modelID
  })

  const options = createMemo(() => {
    const cur = current()
    const sizes = [...new Set([...PRESETS, ...(cur > 0 ? [cur] : [])])].sort((a, b) => a - b)
    return sizes.map((n) => ({
      value: n,
      title: fmtCtxK(n),
      description: n === cur ? "current" : n > cur ? `+${fmtCtxK(n - cur)}` : undefined,
      highlight: n === cur,
    }))
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
      title={`Context size — ${modelName()}`}
      options={options()}
      flat={true}
      skipFilter={true}
      current={current()}
      onSelect={(opt) => apply(opt.value)}
    />
  )
}
