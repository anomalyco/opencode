import { Show, createEffect, createSignal, on, onCleanup } from "solid-js"
import { useTheme } from "@opencode-ai/ui/theme"
import { createUniver, defaultTheme, LocaleType, LogLevel, mergeLocales } from "@univerjs/presets"
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
import { createUniverSdk, type AddChartInput, type RangeRect, type SetRangeValuesInput } from "@opencode-ai/univer-sdk"
import { registerOfficeUnit } from "@/lib/veritly-univer-files"
import { univerBackendOrigin } from "@/lib/univer-backend-origin"
import { browserUniverSdkWsUrl } from "@/lib/univer-sdk-ws-browser"
import { browserTracer } from "@/lib/telemetry/browser-otel"
import { context, propagation, SpanStatusCode, type TextMapGetter } from "@opentelemetry/api"

type PendingImport = { base64: string; mimeType?: string }
type RelayRequest = { id: string; op: string; params?: unknown; traceparent?: string }
type RelayResponse = { id: string; ok: boolean; result?: unknown; error?: string; traceparent?: string }

const relayTextMapSetter = {
  set(carrier: Record<string, string>, key: string, value: string) {
    carrier[key] = value
  },
}

const relayTextMapGetter: TextMapGetter<Record<string, string>> = {
  get(carrier, key) {
    return carrier[key]
  },
  keys(carrier) {
    return Object.keys(carrier)
  },
}
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
      w.__veritlyUniverSdk = () => createUniverSdk({ univerAPI: instance.univerAPI, univer: instance.univer })
    }

    browserTracer().startActiveSpan(
      "spreadsheet.viewer.univer_init",
      {
        attributes: {
          "veritly.project_id": props.projectId ?? "",
          "veritly.unit_id": props.unitId ?? "",
          "veritly.has_office_path": Boolean(props.officePath),
        },
      },
      (span) => {
        span.end()
      },
    )

    onCleanup(() => {
      browserTracer().startActiveSpan(
        "spreadsheet.viewer.univer_dispose",
        {
          attributes: {
            "veritly.project_id": props.projectId ?? "",
            "veritly.unit_id": props.unitId ?? "",
          },
        },
        (span) => {
          span.end()
        },
      )
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
    createUniverSdk({ univerAPI: cur.univerAPI, univer: cur.univer }).toggleDarkMode(theme.mode() === "dark")
  })

  createEffect(() => {
    const el = host()
    if (!el || typeof window === "undefined") return
    const cur = runtime
    if (!cur) return
    const wsBase = browserUniverSdkWsUrl()
    if (!wsBase) {
      console.warn(
        "[veritly] VITE_UNIVER_SDK_WS was empty at vite build/dev — the SDK relay WebSocket is disabled. Local: ws://127.0.0.1:18766/ws. Hosted (via OpenCode): /api/univer-sdk-relay/ws — rebuild after setting.",
      )
      return
    }

    relaySocket?.close(1000, "reconnect")
    const join = wsBase.includes("?") ? "&" : "?"
    const wsUrl = `${wsBase}${join}role=browser`
    const ws = new WebSocket(wsUrl)
    relaySocket = ws
    if (import.meta.env.DEV) {
      console.info("[veritly] univer sdk relay connecting", wsUrl)
    }
    const sdk = createUniverSdk({ univerAPI: cur.univerAPI, univer: cur.univer })

    ws.onopen = () => {
      browserTracer().startActiveSpan(
        "spreadsheet.relay.connect",
        {
          attributes: {
            "veritly.relay.role": "browser",
            "veritly.project_id": props.projectId ?? "",
          },
        },
        (span) => {
          span.end()
        },
      )
    }

    const respond = (payload: RelayResponse) => {
      if (ws.readyState !== WebSocket.OPEN) return
      const carrier: Record<string, string> = {}
      propagation.inject(context.active(), carrier, relayTextMapSetter)
      const tp = carrier.traceparent
      ws.send(JSON.stringify(tp ? { ...payload, traceparent: tp } : payload))
    }

    ws.onmessage = async (evt) => {
      let parsed: RelayRequest
      try {
        parsed = JSON.parse(String(evt.data)) as RelayRequest
      } catch {
        await browserTracer().startActiveSpan(
          "relay.browser.message",
          {
            attributes: {
              "messaging.system": "veritly_univer_relay",
              "network.transport": "websocket",
              "messaging.operation": "receive",
              "veritly.relay.role": "browser",
              error: true,
              "messaging.message_payload_size_bytes": String(evt.data).length,
            },
          },
          async (span) => {
            try {
              span.setStatus({ code: SpanStatusCode.ERROR, message: "invalid json" })
              respond({ id: "relay", ok: false, error: "invalid json payload" })
            } finally {
              span.end()
            }
          },
        )
        return
      }

      const tp = typeof parsed.traceparent === "string" ? parsed.traceparent.trim() : ""
      const parentCtx = tp
        ? propagation.extract(context.active(), { traceparent: tp }, relayTextMapGetter)
        : context.active()

      await browserTracer().startActiveSpan(
        "relay.browser.message",
        {
          attributes: {
            "messaging.system": "veritly_univer_relay",
            "network.transport": "websocket",
            "messaging.operation": "receive",
            "veritly.relay.role": "browser",
            "messaging.message_payload_size_bytes": String(evt.data).length,
          },
        },
        parentCtx,
        async (span) => {
          try {
            if (!parsed?.id || !parsed?.op) {
              span.setStatus({ code: SpanStatusCode.ERROR, message: "missing id or op" })
              respond({ id: "relay", ok: false, error: "request must include id and op" })
              return
            }
            const req = parsed
            span.setAttributes({
              "messaging.message_id": req.id,
              "messaging.destination.name": req.op,
            })

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
                      req.params as
                        | {
                            sheetId?: string
                            range?: { startRow: number; endRow: number; startColumn: number; endColumn: number }
                          }
                        | undefined,
                    ),
                  })
                  return
                case "execute_command": {
                  const raw = req.params
                  if (raw === null || typeof raw !== "object") {
                    span.setStatus({ code: SpanStatusCode.ERROR, message: "execute_command params" })
                    respond({ id: req.id, ok: false, error: "execute_command requires params object" })
                    return
                  }
                  const cmdId = Reflect.get(raw, "id")
                  if (typeof cmdId !== "string") {
                    span.setStatus({ code: SpanStatusCode.ERROR, message: "execute_command cmd id" })
                    respond({ id: req.id, ok: false, error: "execute_command requires params.id (string)" })
                    return
                  }
                  const cmdParams = Reflect.get(raw, "params")
                  if (cmdParams !== undefined && (cmdParams === null || typeof cmdParams !== "object")) {
                    span.setStatus({ code: SpanStatusCode.ERROR, message: "execute_command nested params" })
                    respond({
                      id: req.id,
                      ok: false,
                      error: "execute_command params.params must be an object when set",
                    })
                    return
                  }
                  const result = await cur.univerAPI.executeCommand(
                    cmdId,
                    cmdParams === undefined ? undefined : cmdParams,
                  )
                  respond({ id: req.id, ok: true, result })
                  return
                }
                default:
                  span.setStatus({ code: SpanStatusCode.ERROR, message: "unsupported op" })
                  respond({ id: req.id, ok: false, error: `unsupported op: ${req.op}` })
              }
            } catch (err) {
              if (req.op === "add_chart") {
                const info = sdk.inspectFacadeCapabilities()
                console.warn("univer-sdk add_chart failed; facade capabilities:", info)
              }
              span.setStatus({
                code: SpanStatusCode.ERROR,
                message: err instanceof Error ? err.message : "sdk operation failed",
              })
              span.recordException(err instanceof Error ? err : new Error(String(err)))
              respond({ id: req.id, ok: false, error: err instanceof Error ? err.message : "sdk operation failed" })
            }
          } finally {
            span.end()
          }
        },
      )
    }

    ws.onerror = () => {
      if (import.meta.env.DEV) {
        console.error("[veritly] univer sdk relay websocket error", { url: wsUrl })
      }
      browserTracer().startActiveSpan(
        "spreadsheet.relay.error",
        {
          attributes: {
            "veritly.relay.role": "browser",
            "veritly.project_id": props.projectId ?? "",
            error: true,
          },
        },
        (span) => {
          span.setStatus({ code: SpanStatusCode.ERROR, message: "websocket error" })
          span.end()
        },
      )
    }
    ws.onclose = (ev) => {
      if (import.meta.env.DEV) {
        console.warn("[veritly] univer sdk relay closed", {
          url: wsUrl,
          code: ev.code,
          reason: ev.reason || "",
          wasClean: ev.wasClean,
        })
      }
      browserTracer().startActiveSpan(
        "spreadsheet.relay.disconnect",
        {
          attributes: {
            "veritly.relay.role": "browser",
            "veritly.project_id": props.projectId ?? "",
            "relay.close_code": ev.code,
            "relay.close_reason_length": (ev.reason || "").length,
          },
        },
        (span) => {
          if (ev.code !== 1000 && ev.code !== 1005) {
            span.setStatus({ code: SpanStatusCode.ERROR, message: `ws closed code=${ev.code}` })
          }
          span.end()
        },
      )
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

        const sdk = createUniverSdk({ univerAPI: cur.univerAPI, univer: cur.univer })

        await browserTracer().startActiveSpan(
          "spreadsheet.workbook.load",
          {
            attributes: {
              "veritly.unit_id": unitId,
              "veritly.load_kind": unitId.startsWith("pending-") ? "import" : "server",
              "veritly.unit_type": unitType,
              "veritly.project_id": projectId ?? "",
              "veritly.office_path": officePath ?? "",
            },
          },
          async (span) => {
            try {
              if (stale()) return

              if (unitId.startsWith("pending-")) {
                if (!officePath || !pendingB64) {
                  span.setStatus({
                    code: SpanStatusCode.ERROR,
                    message: "missing file payload for pending import",
                  })
                  setError("Spreadsheet is not imported yet (missing file payload). Reload the file or re-upload.")
                  return
                }
                const name = officePath.split("/").pop() || "workbook.xlsx"
                const file = base64ToFile(pendingB64, name, pendingMime)
                const realId = await sdk.importXlsxToUnit(file)
                if (stale()) return
                if (!realId) {
                  span.setStatus({ code: SpanStatusCode.ERROR, message: "import returned no unit id" })
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
              const msg = e instanceof Error ? e.message : "Failed to load sheet"
              span.setStatus({ code: SpanStatusCode.ERROR, message: msg })
              if (e instanceof Error) span.recordException(e)
              setError(msg)
            } finally {
              if (!stale()) setLoading(false)
              span.end()
            }
          },
        )
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
