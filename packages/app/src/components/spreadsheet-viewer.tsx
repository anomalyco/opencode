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
import { registerOfficeUnit } from "@/lib/veritly-univer-files"

type PendingImport = { base64: string; mimeType?: string }

type UniverApiWithExchange = {
  importXLSXToUnitIdAsync(file: File): Promise<string | undefined>
  loadServerUnit(unitId: string, unitType: number): void
  toggleDarkMode(on: boolean): void
}

type Props = {
  unitId?: string
  unitType?: 1 | 2 | 3
  officePath?: string
  pendingImport?: PendingImport
  projectId?: string
  onUnitRegistered?: () => void
}

const UNIVERSER_BASE = import.meta.env.VITE_UNIVERSER_URL?.trim() || "http://127.0.0.1:8000"
const UNIVER_LICENSE = import.meta.env.VITE_UNIVER_LICENSE?.trim() ?? ""

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
  let seq = 0

  createEffect(() => {
    const el = host()
    if (!el || typeof window === "undefined") return

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

    onCleanup(() => {
      runtime = null
      instance.univer.dispose()
    })
  })

  createEffect(() => {
    const cur = runtime
    if (!cur) return
    cur.univerAPI.toggleDarkMode(theme.mode() === "dark")
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

        const api = cur.univerAPI as unknown as UniverApiWithExchange

        try {
          if (stale()) return

          if (unitId.startsWith("pending-")) {
            if (!officePath || !pendingB64) {
              setError("Spreadsheet is not imported yet (missing file payload). Reload the file or re-upload.")
              return
            }
            const name = officePath.split("/").pop() || "workbook.xlsx"
            const file = base64ToFile(pendingB64, name, pendingMime)
            const realId = await api.importXLSXToUnitIdAsync(file)
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

          api.loadServerUnit(unitId, unitType)
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
