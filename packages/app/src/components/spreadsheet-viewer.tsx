import { Show, createEffect, createSignal, on, onCleanup } from "solid-js"
import { useTheme } from "@opencode-ai/ui/theme"
import {
  createUniver,
  defaultTheme,
  LocaleType,
  LogLevel,
  mergeLocales,
} from "@univerjs/presets"
import { UniverSheetsCorePreset } from "@univerjs/presets/preset-sheets-core"
import sheetsCoreEnUs from "@univerjs/presets/preset-sheets-core/locales/en-US"
import "@univerjs/presets/lib/styles/preset-sheets-core.css"
import { UniverSheetsDrawingPreset } from "@univerjs/presets/preset-sheets-drawing"
import sheetsDrawingEnUs from "@univerjs/presets/preset-sheets-drawing/locales/en-US"
import "@univerjs/presets/lib/styles/preset-sheets-drawing.css"
import { UniverSheetsAdvancedPreset } from "@univerjs/presets/preset-sheets-advanced"
import sheetsAdvancedEnUs from "@univerjs/presets/preset-sheets-advanced/locales/en-US"
import "@univerjs/presets/lib/styles/preset-sheets-advanced.css"
import { UniverSheetsCollaborationPreset } from "@univerjs/presets/preset-sheets-collaboration"
import sheetsCollaborationEnUs from "@univerjs/presets/preset-sheets-collaboration/locales/en-US"
import "@univerjs/presets/lib/styles/preset-sheets-collaboration.css"
import {
  createUniverSdk,
  type AddChartInput,
  type RangeRect,
  type SetRangeValuesInput,
} from "@opencode-ai/univer-sdk"
import { registerOfficeUnit } from "@/lib/veritly-univer-files"
import { univerBackendOrigin } from "@/lib/univer-backend-origin"

type PendingImport = { base64: string; mimeType?: string }
type RelayRequest = { id: string; op: string; params?: unknown }
type RelayResponse = { id: string; ok: boolean; result?: unknown; error?: string }
type GetRangeInput = { sheetId?: string; range: RangeRect }

type Props = {
  unitId?: string
  unitType?: 1 | 2 | 3
  officePath?: string
  pendingImport?: PendingImport
  projectId?: string
  onUnitRegistered?: () => void
}

const UNIVERSER_BASE = univerBackendOrigin()
const UNIVER_LICENSE = import.meta.env.VITE_UNIVER_LICENSE?.trim() ?? ""

type VeritlyWindow = Window & { __veritlyUniverSdk?: () => ReturnType<typeof createUniverSdk> }

function base64ToFile(base64: string, name: string, mimeType?: string): File {
  const bin = atob(base64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return new File([bytes], name, { type: mimeType || "application/octet-stream" })
}

export function SpreadsheetViewer(props: Props) {
  const theme = useTheme()
  const [host, setHost] = createSignal<HTMLDivElement | undefined>()
  const [error, setError] = createSignal<string | null>(null)
  const [loading, setLoading] = createSignal(false)

  let runtime: ReturnType<typeof createUniver> | null = null
  let relaySocket: WebSocket | null = null
  let seq = 0

  createEffect(() => {
    const el = host()
    if (!el || typeof window === "undefined") return

    // `createUniver` only clears core IUndoRedoService (etc.) when `collaboration` is truthy.
    // If you omit it but keep `UniverSheetsCollaborationPreset`, core + collab both register undo → crash.
    const instance = createUniver({
      locale: LocaleType.EN_US,
      locales: {
        [LocaleType.EN_US]: mergeLocales(
          sheetsCoreEnUs,
          sheetsDrawingEnUs,
          sheetsAdvancedEnUs,
          sheetsCollaborationEnUs,
        ),
      },
      collaboration: true,
      logLevel: LogLevel.WARN,
      theme: defaultTheme,
      presets: [
        UniverSheetsCorePreset({
          container: el,
          header: true,
          toolbar: true,
          ribbonType: "classic",
          formulaBar: true,
          // @ts-expect-error sheets-ui types omit boolean `true`; valid runtime option
          footer: true,
        }),
        UniverSheetsDrawingPreset({ collaboration: true }),
        UniverSheetsAdvancedPreset({
          universerEndpoint: UNIVERSER_BASE,
          license: UNIVER_LICENSE,
        }),
        UniverSheetsCollaborationPreset({
          universerEndpoint: UNIVERSER_BASE,
          univerContainerId: "univer",
        }),
      ],
    })

    runtime = instance
    if (import.meta.env.DEV) {
      const w = window as VeritlyWindow
      w.__veritlyUniverSdk = () => createUniverSdk({ univerAPI: instance.univerAPI, univer: instance.univer as never })
    }

    onCleanup(() => {
      relaySocket?.close(1000, "viewer disposed")
      relaySocket = null
      runtime = null
      if (import.meta.env.DEV) {
        const w = window as VeritlyWindow
        delete w.__veritlyUniverSdk
      }
      instance.univer.dispose()
    })
  })

  createEffect(() => {
    const cur = runtime
    if (!cur) return
    createUniverSdk({ univerAPI: cur.univerAPI, univer: cur.univer as never }).toggleDarkMode(theme.mode() === "dark")
  })

  createEffect(() => {
    const cur = runtime
    if (!cur) return
    const wsBase = import.meta.env.VITE_UNIVER_SDK_WS?.trim()
    if (!wsBase) return

    relaySocket?.close(1000, "reconnect")
    const join = wsBase.includes("?") ? "&" : "?"
    const ws = new WebSocket(`${wsBase}${join}role=browser`)
    relaySocket = ws
    const sdk = createUniverSdk({ univerAPI: cur.univerAPI, univer: cur.univer as never })

    const respond = (payload: RelayResponse) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(payload))
    }

    ws.onmessage = async (evt) => {
      let req: RelayRequest
      try {
        req = JSON.parse(String(evt.data)) as RelayRequest
      } catch {
        respond({ id: "relay", ok: false, error: "invalid json payload" })
        return
      }
      if (!req?.id || !req?.op) {
        respond({ id: "relay", ok: false, error: "request must include id and op" })
        return
      }

      try {
        switch (req.op) {
          case "get_active_document":
            respond({ id: req.id, ok: true, result: sdk.getActiveDocument() })
            return
          case "list_sheets":
            respond({ id: req.id, ok: true, result: sdk.listSheets() })
            return
          case "get_range":
            respond({ id: req.id, ok: true, result: sdk.getSheetRange(req.params as GetRangeInput) })
            return
          case "set_range":
            sdk.setRangeValues(req.params as SetRangeValuesInput)
            respond({ id: req.id, ok: true, result: true })
            return
          case "add_chart":
            respond({ id: req.id, ok: true, result: await sdk.addChart(req.params as AddChartInput) })
            return
          case "sdk_introspect":
            respond({
              id: req.id,
              ok: true,
              result: sdk.inspectFacadeCapabilities(
                req.params as { sheetId?: string; range?: { startRow: number; endRow: number; startColumn: number; endColumn: number } } | undefined,
              ),
            })
            return
          case "execute_command": {
            const p = (req.params ?? {}) as { id?: string; params?: unknown }
            if (!p.id) {
              respond({ id: req.id, ok: false, error: "execute_command requires params.id" })
              return
            }
            if (!cur.univerAPI.executeCommand) {
              respond({ id: req.id, ok: false, error: "univerAPI.executeCommand unavailable" })
              return
            }
            const result = await cur.univerAPI.executeCommand(p.id, p.params)
            respond({ id: req.id, ok: true, result })
            return
          }
          default:
            respond({ id: req.id, ok: false, error: `unsupported op: ${req.op}` })
        }
      } catch (err) {
        if (req.op === "add_chart") {
          const info = sdk.inspectFacadeCapabilities()
          console.warn("univer-sdk add_chart failed; facade capabilities:", info)
        }
        respond({ id: req.id, ok: false, error: err instanceof Error ? err.message : "sdk operation failed" })
      }
    }

    ws.onerror = () => {
      if (import.meta.env.DEV) console.error("univer sdk relay websocket error")
    }
    ws.onclose = () => {
      if (relaySocket === ws) relaySocket = null
    }

    onCleanup(() => {
      if (relaySocket === ws) relaySocket = null
      ws.close(1000, "effect cleanup")
    })
  })

  createEffect(
    on(
      () =>
        [
          props.unitId,
          props.unitType ?? 2,
          props.officePath,
          props.pendingImport?.base64,
          props.pendingImport?.mimeType,
          props.projectId,
        ] as const,
      async ([unitId, unitType, officePath, pendingB64, pendingMime, projectId]) => {
        if (!unitId) return
        const cur = runtime
        if (!cur) return

        setLoading(true)
        setError(null)

        const id = ++seq
        const stale = () => id !== seq || runtime !== cur

        const sdk = createUniverSdk({ univerAPI: cur.univerAPI, univer: cur.univer as never })

        try {
          if (stale()) return

          if (unitId.startsWith("pending-")) {
            if (!officePath || !pendingB64) {
              setError("Spreadsheet is not imported yet (missing file payload). Reload the file or re-upload.")
              return
            }
            const name = officePath.split("/").pop() || "workbook.xlsx"
            const file = base64ToFile(pendingB64, name, pendingMime)
            const realId = await sdk.importXlsxToUnit(file)
            if (stale()) return
            if (!realId) {
              setError("Univer import returned no unit id")
              return
            }
            await registerOfficeUnit(officePath, realId, { projectId })
            if (stale()) return
            props.onUnitRegistered?.()
            return
          }

          sdk.loadServerUnit(unitId, unitType)
        } catch (e) {
          if (stale()) return
          setError(e instanceof Error ? e.message : "Failed to load sheet")
        } finally {
          if (!stale()) setLoading(false)
        }
      },
    ),
  )

  return (
    <div class="flex h-full min-h-0 w-full min-w-0 flex-1 flex-col gap-2">
      <Show when={loading()}>
        <div class="text-muted-foreground shrink-0 text-sm">Loading spreadsheet…</div>
      </Show>
      <Show when={error()}>{(err) => <div class="text-destructive shrink-0 text-sm">{err()}</div>}</Show>
      <div id="univer" ref={setHost} class="min-h-[min(480px,70dvh)] w-full min-w-0 flex-1" />
    </div>
  )
}
