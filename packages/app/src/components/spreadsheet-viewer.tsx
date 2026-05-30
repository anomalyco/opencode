import { Show, createEffect, createSignal, on, onCleanup, untrack } from "solid-js"
import { useTheme, resolveThemeVariant } from "@opencode-ai/ui/theme"
import { createUniver, defaultTheme, LocaleType, LogLevel, mergeLocales } from "@univerjs/presets"
import { UniverSheetsCorePreset } from "@univerjs/presets/preset-sheets-core"
import sheetsCoreEnUs from "@univerjs/presets/preset-sheets-core/locales/en-US"
import "@univerjs/presets/lib/styles/preset-sheets-core.css"
import { UniverSheetsDrawingPreset } from "@univerjs/presets/preset-sheets-drawing"
import sheetsDrawingEnUs from "@univerjs/presets/preset-sheets-drawing/locales/en-US"
import "@univerjs/presets/lib/styles/preset-sheets-drawing.css"
import "../styles/univer-theme.css"
import { ThemeService } from "@univerjs/core"
import { IRenderManagerService } from "@univerjs/engine-render"
import type { FUniver } from "@univerjs/core/facade"
import type { IFUniverUIMixin } from "@univerjs/ui/facade"
import {
  createUniverSdk,
  createVeritlyUniverBridge,
  dispatchUniverOp,
  type PushSetRangeInput,
  type RelayRequest,
  type RelayResponse,
  type UniverHostApi,
  type UniverSdkRuntime,
  type VeritlyUniverBridgeWindow,
} from "@opencode-ai/univer-sdk"
import { VeritlyLiveChartPlugin, bindVeritlyChartHost, clearVeritlyChartHost, registerVeritlyLiveChartFloat } from "@opencode-ai/veritly-univer-chart"
import { bindVeritlyUniverHost, clearVeritlyUniverHost, type Host } from "@/lib/veritly-univer-runtime"
import { augmentVeritlyHost } from "@/lib/veritly-univer-host-api"
import { univerBackendOrigin } from "@/lib/univer-backend-origin"
import { browserUniverSdkWsUrl } from "@/lib/univer-sdk-ws-browser"
import { browserTracer } from "@/lib/telemetry/browser-otel"
import { context, propagation, SpanStatusCode, type TextMapGetter } from "@opentelemetry/api"

type PendingImport = { base64: string; mimeType?: string }

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
type Props = {
  unitId?: string
  unitType?: 1 | 2 | 3
  officePath?: string
  pendingImport?: PendingImport
  projectId?: string
  /** After import, Univer’s real unit id (replaces `pending-*` in file state). */
  onUnitResolved?: (unitId: string) => void
}

const UNIVERSER_BASE = univerBackendOrigin()

/** `createUniverSdk` only — host HTTP/comb wiring is applied once per runtime in the mount effect (`augmentVeritlyHost`). */
function veritlySdk(cur: ReturnType<typeof createUniver>) {
  return createUniverSdk({
    univerAPI: cur.univerAPI,
    univer: cur.univer,
  } as unknown as UniverSdkRuntime)
}

type VeritlyWindow = VeritlyUniverBridgeWindow & { __veritlyUniverSdk?: () => ReturnType<typeof createUniverSdk> }

function base64ToFile(base64: string, name: string, mimeType?: string): File {
  const bin = atob(base64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return new File([bytes], name, { type: mimeType || "application/octet-stream" })
}

/** Build the setCustomHeader config for row/column headers.
 *
 * getRenderColor() behaviour differs by mode:
 *  - dark:  theme key strings ("gray.800") are resolved via ThemeService — no inversion applied.
 *  - light: the color value is returned as-is, so "gray.800" would reach canvas.fillStyle
 *           as a literal string → invalid CSS → black. Pass real hex values instead.
 */
function buildHeaderCfg(isDark: boolean, themeService: InstanceType<typeof ThemeService>) {
  if (isDark) {
    return {
      headerStyle: {
        backgroundColor: "gray.800",
        fontColor: "white",
        borderColor: "gray.700",
      },
    }
  }
  const gray = themeService.getCurrentTheme().gray as Record<string, string>
  return {
    headerStyle: {
      backgroundColor: gray["100"] ?? "#f3f3f3",
      fontColor: gray["500"] ?? "#8f8f8f",
      borderColor: gray["200"] ?? "#e8e8e8",
    },
  }
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

    // No `UniverSheetsCollaborationPreset`: `@univerjs/presets/preset-sheets-collaboration` re-exports Univer Pro
    // (`@univerjs-pro/collaboration`, edit-history, …). Multiplayer / universer comb must be built as Veritly-owned
    // primitives against `@opencode-ai/univer-compat` (or similar), not this preset.

    const getVeritlyTheme = (themeId: string) => {
      const activeTheme = theme.themes()[themeId]
      const lightTokens = activeTheme ? resolveThemeVariant(activeTheme.light, false) : null
      const darkTokens = activeTheme ? resolveThemeVariant(activeTheme.dark, true) : null

      const getLight = (v: string, fb: string) => (lightTokens?.[v as keyof typeof lightTokens] as string) || fb
      const getDark = (v: string, fb: string) => (darkTokens?.[v as keyof typeof darkTokens] as string) || fb

      const buildRamp = (baseKey: string, fallback: Record<string, string>) => {
        return {
          50: getLight(`surface-${baseKey}-weak`, fallback["50"]),
          100: getLight(`surface-${baseKey}-weak`, fallback["100"]),
          200: getLight(`surface-${baseKey}-base`, fallback["200"]),
          300: getLight(`border-${baseKey}-base`, fallback["300"]),
          400: getLight(`border-${baseKey}-base`, fallback["400"]),
          500: getLight(`surface-${baseKey}-strong`, fallback["500"]),
          600: getDark(`surface-${baseKey}-strong`, fallback["600"]),
          700: getDark(`border-${baseKey}-base`, fallback["700"]),
          800: getDark(`surface-${baseKey}-base`, fallback["800"]),
          900: getDark(`surface-${baseKey}-weak`, fallback["900"]),
        }
      }

      return {
        ...defaultTheme,
        primary: buildRamp('brand', defaultTheme.primary),
        gray: {
          50: getLight('background-weak', '#f8f8f8'),
          100: getLight('background-base', '#f3f3f3'),
          200: getLight('border-weaker-base', '#e8e8e8'),
          300: getLight('border-weak-base', '#dbdbdb'),
          400: getLight('border-base', '#c7c7c7'),
          500: getLight('icon-base', '#8f8f8f'),
          600: getDark('icon-base', '#52525b'),
          700: getDark('border-base', '#475569'),
          800: getDark('surface-raised-stronger-non-alpha', '#1E293B'),
          900: getDark('background-base', '#0b0f1a'),
        },
        white: getLight('background-stronger', '#ffffff'),
        black: getDark('background-strong', '#111827'),
        green: buildRamp('success', defaultTheme.green),
        red: buildRamp('critical', defaultTheme.red),
        yellow: buildRamp('warning', defaultTheme.yellow),
        orange: buildRamp('warning', defaultTheme.orange),
        blue: buildRamp('interactive', defaultTheme.blue),
        indigo: buildRamp('interactive', defaultTheme.indigo),
        jiqing: buildRamp('interactive', defaultTheme.jiqing),
        purple: buildRamp('info', defaultTheme.purple),
        pink: buildRamp('info', defaultTheme.pink),
      }
    }

    const instance = createUniver({
      locale: LocaleType.EN_US,
      locales: {
        [LocaleType.EN_US]: mergeLocales(sheetsCoreEnUs, sheetsDrawingEnUs),
      },
      logLevel: LogLevel.WARN,
      theme: getVeritlyTheme(untrack(() => theme.themeId())),
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
        UniverSheetsDrawingPreset({ collaboration: false }),
      ],
      plugins: [VeritlyLiveChartPlugin],
    })

    const chartReg = registerVeritlyLiveChartFloat(instance.univerAPI as FUniver & IFUniverUIMixin)

    augmentVeritlyHost(instance.univerAPI, instance.univer, UNIVERSER_BASE, () => {
      const p = props.projectId?.trim()
      if (!p) throw new Error("SpreadsheetViewer requires projectId")
      return p
    })
    bindVeritlyUniverHost({
      univerAPI: instance.univerAPI,
      univer: instance.univer,
    } as Host)
    bindVeritlyChartHost({
      univerAPI: instance.univerAPI,
      univer: instance.univer,
    })

    runtime = instance
    const sdkRuntime = {
      univerAPI: instance.univerAPI,
      univer: instance.univer,
    } as UniverSdkRuntime
    const sdk = veritlySdk(instance)
    const w = window as VeritlyWindow
    w.__veritlyUniverBridge = createVeritlyUniverBridge(sdk, sdkRuntime)
    w.__veritlyUniverSdk = () => sdk

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
      clearVeritlyUniverHost()
      clearVeritlyChartHost()
      chartReg.dispose()
      runtime = null
      const w = window as VeritlyWindow
      delete w.__veritlyUniverBridge
      delete w.__veritlyUniverSdk
      instance.univer.dispose()
    })
    
    // Apply initial dark mode immediately
    const initialDark = untrack(() => theme.mode()) === "dark"
    veritlySdk(instance).toggleDarkMode(initialDark)

    // Apply header theme when each workbook render unit is created. getRenderAll() is empty
    // at this point (no workbook loaded yet), so we subscribe to created$ instead.
    // Render controllers subscribe during createUniver() and run before us, so components
    // (__SpreadsheetRowHeader__ / __SpreadsheetColumnHeader__) are already registered by the
    // time our callback fires.
    const initInjector = instance.univer.__getInjector()
    const renderManager = initInjector.get(IRenderManagerService)
    const createdSub = renderManager.created$.subscribe((render) => {
      const isDark = untrack(() => theme.mode()) === "dark"
      const cfg = buildHeaderCfg(isDark, initInjector.get(ThemeService))
      ;(render.components.get("__SpreadsheetRowHeader__") as any)?.setCustomHeader?.(cfg)
      ;(render.components.get("__SpreadsheetColumnHeader__") as any)?.setCustomHeader?.(cfg)
    })
    onCleanup(() => createdSub.unsubscribe())
  })

  // Reactively inject HTML UI colors when theme changes
  createEffect(() => {
    const themeId = theme.themeId() // tracks themeId changes
    
    // We duplicate getVeritlyTheme here since it depends on the reactive theme object
    const activeTheme = theme.themes()[themeId]
    if (!activeTheme) return

    const lightTokens = resolveThemeVariant(activeTheme.light, false)
    const darkTokens = resolveThemeVariant(activeTheme.dark, true)

    const getLight = (v: string, fb: string) => (lightTokens?.[v as keyof typeof lightTokens] as string) || fb
    const getDark = (v: string, fb: string) => (darkTokens?.[v as keyof typeof darkTokens] as string) || fb

    const buildRamp = (baseKey: string, fallback: Record<string, string>) => {
      return {
        50: getLight(`surface-${baseKey}-weak`, fallback["50"]),
        100: getLight(`surface-${baseKey}-weak`, fallback["100"]),
        200: getLight(`surface-${baseKey}-base`, fallback["200"]),
        300: getLight(`border-${baseKey}-base`, fallback["300"]),
        400: getLight(`border-${baseKey}-base`, fallback["400"]),
        500: getLight(`surface-${baseKey}-strong`, fallback["500"]),
        600: getDark(`surface-${baseKey}-strong`, fallback["600"]),
        700: getDark(`border-${baseKey}-base`, fallback["700"]),
        800: getDark(`surface-${baseKey}-base`, fallback["800"]),
        900: getDark(`surface-${baseKey}-weak`, fallback["900"]),
      }
    }

    const currentTheme = {
      ...defaultTheme,
      primary: buildRamp('brand', defaultTheme.primary),
      gray: {
        50: getLight('background-weak', '#f8f8f8'),
        100: getLight('background-base', '#f3f3f3'),
        200: getLight('border-weaker-base', '#e8e8e8'),
        300: getLight('border-weak-base', '#dbdbdb'),
        400: getLight('border-base', '#c7c7c7'),
        500: getLight('icon-base', '#8f8f8f'),
        600: getDark('icon-base', '#52525b'),
        700: getDark('border-base', '#475569'),
        800: getDark('surface-raised-stronger-non-alpha', '#1E293B'),
        900: getDark('background-base', '#0b0f1a'),
      },
      white: getLight('background-stronger', '#ffffff'),
      black: getDark('background-strong', '#111827'),
      green: buildRamp('success', defaultTheme.green),
      red: buildRamp('critical', defaultTheme.red),
      yellow: buildRamp('warning', defaultTheme.yellow),
      orange: buildRamp('warning', defaultTheme.orange),
      blue: buildRamp('interactive', defaultTheme.blue),
      indigo: buildRamp('interactive', defaultTheme.indigo),
      jiqing: buildRamp('interactive', defaultTheme.jiqing),
      purple: buildRamp('info', defaultTheme.purple),
      pink: buildRamp('info', defaultTheme.pink),
    }

    let style = document.getElementById('veritly-univer-theme')
    if (!style) {
      style = document.createElement('style')
      style.id = 'veritly-univer-theme'
      document.head.appendChild(style)
    }

    const cssVars = Object.entries(currentTheme).flatMap(([colorName, scale]) => {
      if (typeof scale === 'string') {
        return [`--univer-${colorName}: ${scale};`]
      }
      return Object.entries(scale).map(([shade, hex]) => {
        return `--univer-${colorName}-${shade}: ${hex};`
      })
    })

    style.innerHTML = `
      #univer {
        ${cssVars.join('\n        ')}
      }
    `

    if (runtime) {
      const injector = runtime.univer.__getInjector()
      injector.get(ThemeService).setTheme(currentTheme)

      const themeService = injector.get(ThemeService)
      const isDark = untrack(() => theme.mode()) === "dark"
      const cfg = buildHeaderCfg(isDark, themeService)
      injector.get(IRenderManagerService).getRenderAll().forEach((render) => {
        const rowHeader = render.components.get("__SpreadsheetRowHeader__") as any
        const colHeader = render.components.get("__SpreadsheetColumnHeader__") as any
        rowHeader?.setCustomHeader?.(cfg)
        colHeader?.setCustomHeader?.(cfg)
      })
    }
  })

  createEffect(() => {
    const cur = runtime
    if (!cur) return
    const isDark = theme.mode() === "dark"
    veritlySdk(cur).toggleDarkMode(isDark)

    const injector = cur.univer.__getInjector()
    const headerCfg = buildHeaderCfg(isDark, injector.get(ThemeService))
    injector.get(IRenderManagerService).getRenderAll().forEach((render) => {
      const rowHeader = render.components.get("__SpreadsheetRowHeader__") as any
      const colHeader = render.components.get("__SpreadsheetColumnHeader__") as any
      rowHeader?.setCustomHeader?.(headerCfg)
      colHeader?.setCustomHeader?.(headerCfg)
    })
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
    const sdk = veritlySdk(cur)

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

            const runtimeInput = {
              univerAPI: cur.univerAPI,
              univer: cur.univer,
            } as UniverSdkRuntime
            const resp = await dispatchUniverOp(sdk, runtimeInput, req)
            if (!resp.ok) {
              if (req.op === "add_chart") {
                console.warn("univer-sdk add_chart failed; facade capabilities:", sdk.inspectFacadeCapabilities())
              }
              span.setStatus({ code: SpanStatusCode.ERROR, message: resp.error ?? "sdk operation failed" })
            }
            respond(resp)
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

  /** Local edits → universer HTTP `new_changes` (incremental); no full snapshot `save`. */
  createEffect(() => {
    const cur = runtime
    const uid = props.unitId
    if (!cur || !uid || uid.startsWith("pending-")) return

    const api = cur.univerAPI as unknown as UniverHostApi
    const handle = (event: unknown) => {
      const o = event as { id?: string; params?: unknown }
      const p = o.params
      if (!p || typeof p !== "object") return
      const unitId = Reflect.get(p, "unitId")
      if (typeof unitId !== "string" || unitId !== uid) return

      if (o.id === "sheet.mutation.set-range-values") {
        const sheetId = Reflect.get(p, "subUnitId")
        if (typeof sheetId !== "string") return
        const cellValue = Reflect.get(p, "cellValue")
        if (!cellValue || typeof cellValue !== "object") return

        const raw = Reflect.get(p, "range")
        const push = api.pushSetRangeToServerDebounced
        if (!push) return
        const out: PushSetRangeInput = {
          unitId,
          sheetId,
          cellValue: cellValue as PushSetRangeInput["cellValue"],
        }
        if (raw && typeof raw === "object") {
          const sr = Reflect.get(raw, "startRow")
          const er = Reflect.get(raw, "endRow")
          const sc = Reflect.get(raw, "startColumn")
          const ec = Reflect.get(raw, "endColumn")
          if (
            typeof sr === "number" &&
            typeof er === "number" &&
            typeof sc === "number" &&
            typeof ec === "number"
          ) {
            out.range = { startRow: sr, endRow: er, startColumn: sc, endColumn: ec }
          }
        }
        push(out)
        return
      }

      if (o.id === "sheet.mutation.set-drawing-apply") {
        const pushComb = api.pushCombMutationsToServer
        if (!pushComb) return
        const cloned = JSON.parse(JSON.stringify(p)) as Record<string, unknown>
        void pushComb({
          unitId: uid,
          mutations: [{ id: o.id, params: cloned }],
        })
      }
    }
    const sub = api.addEvent(api.Event.CommandExecuted, handle)
    onCleanup(() => {
      sub.dispose()
      void api.flushVeritlyCombForUnit?.(uid)
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

        const sdk = veritlySdk(cur)

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
                props.onUnitResolved?.(realId)
                return
              }

              await sdk.loadServerUnit(unitId, unitType)
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
      <div class="flex min-h-0 min-w-0 flex-1 flex-row gap-0">
        <div
          id="univer"
          ref={setHost}
          class="min-h-[min(480px,70dvh)] min-w-0 flex-1"
        />
      </div>
    </div>
  )
}
