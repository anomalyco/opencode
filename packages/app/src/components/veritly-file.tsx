import { File } from "@opencode-ai/ui/file"
import type { FileProps } from "@opencode-ai/ui/file"
import { useFile } from "@/context/file"
import { useSDK } from "@/context/sdk"
import { SpreadsheetViewer } from "./spreadsheet-viewer"

type OfficeMeta = {
  unitId?: string
  unitKind?: "sheet" | "doc" | "slide"
  content?: string
  mimeType?: string
}

function unitTypeFromKind(kind?: OfficeMeta["unitKind"]): 1 | 2 | 3 {
  if (kind === "doc") return 1
  if (kind === "slide") return 3
  return 2
}

function isSpreadsheetPath(path?: string): boolean {
  if (!path) return false
  return /\.(xlsx|xlsm|xls|csv)$/i.test(path)
}

export function VeritlyFile(props: FileProps) {
  const file = useFile()
  const sdk = useSDK()
  const media = (props as any).media as { path?: string; current?: unknown } | undefined
  const meta = media?.current as OfficeMeta | undefined
  const p = media?.path

  if (isSpreadsheetPath(p) && meta?.unitId) {
    const pending = meta.unitId.startsWith("pending-")
    const base64 = typeof meta.content === "string" ? meta.content : undefined
    const pendingImport = pending && base64 ? { base64, mimeType: meta.mimeType } : undefined
    return (
      <SpreadsheetViewer
        unitId={meta.unitId}
        unitType={unitTypeFromKind(meta.unitKind)}
        officePath={p}
        pendingImport={pendingImport}
        projectId={sdk.directory || "default"}
        onUnitRegistered={() => {
          if (p) void file.load(p, { force: true })
        }}
      />
    )
  }

  return <File {...props} />
}
