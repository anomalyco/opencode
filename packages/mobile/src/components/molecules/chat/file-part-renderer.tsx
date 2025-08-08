import { memo } from "react"
import { Box, Text } from "@/components/ui/primitives"
import { FileContentRenderer } from "./renderers"

interface FilePartRendererProps {
  part: any
  type: "file" | "snapshot" | "patch"
}

export const FilePartRenderer = memo(
  ({ part, type }: FilePartRendererProps) => {
    switch (type) {
      case "file":
        return <FileRenderer part={part} />
      case "snapshot":
        return <SnapshotRenderer part={part} />
      case "patch":
        return <PatchRenderer part={part} />
      default:
        return null
    }
  },
  (prevProps, nextProps) => {
    return (
      prevProps.type === nextProps.type &&
      prevProps.part.fileFilename === nextProps.part.fileFilename &&
      prevProps.part.fileUrl === nextProps.part.fileUrl &&
      prevProps.part.snapshotId === nextProps.part.snapshotId &&
      prevProps.part.patchHash === nextProps.part.patchHash
    )
  },
)

FilePartRenderer.displayName = "FilePartRenderer"

const FileRenderer = memo(({ part }: { part: any }) => {
  const filename = part.fileFilename
  const fileUrl = part.fileUrl
  const fileMime = part.fileMime
  const sourceType = part.fileSourceType
  const sourcePath = part.fileSourcePath
  const sourceTextStart = part.fileSourceTextStart
  const sourceTextEnd = part.fileSourceTextEnd
  const sourceName = part.fileSourceName
  const sourceRange = part.fileSourceRange
    ? typeof part.fileSourceRange === "string"
      ? JSON.parse(part.fileSourceRange)
      : part.fileSourceRange
    : null

  if (filename && fileUrl) {
    return (
      <Box>
        <FileContentRenderer filename={filename} content={fileUrl} />
        {(sourceType || sourcePath || sourceName) && (
          <Box mt="xs" p="xs" background="lighter" rounded="sm">
            <Text size="xs" mode="subtle">
              {sourceType === "symbol" && sourceName && `Symbol: ${sourceName}`}
              {sourceType === "file" && sourcePath && `Path: ${sourcePath}`}
              {sourceTextStart !== null && sourceTextEnd !== null && ` (${sourceTextStart}-${sourceTextEnd})`}
              {fileMime && ` • ${fileMime}`}
            </Text>
            {sourceRange && (
              <Text size="xs" mode="subtle" style={{ fontFamily: "monospace", marginTop: 2 }}>
                Range: {JSON.stringify(sourceRange)}
              </Text>
            )}
          </Box>
        )}
      </Box>
    )
  }

  return null
})

FileRenderer.displayName = "FileRenderer"

const SnapshotRenderer = memo(({ part }: { part: any }) => {
  const snapshotId = part.snapshotId

  if (!snapshotId) return null

  return (
    <Box background="subtle" rounded="md" p="sm">
      <Text size="xs" weight="medium" mode="subtle">
        📸 Snapshot: {snapshotId}
      </Text>
    </Box>
  )
})

SnapshotRenderer.displayName = "SnapshotRenderer"

const PatchRenderer = memo(({ part }: { part: any }) => {
  const patchHash = part.patchHash
  const patchFiles = part.patchFiles
    ? typeof part.patchFiles === "string"
      ? JSON.parse(part.patchFiles)
      : part.patchFiles
    : null

  if (!patchHash && !patchFiles) return null

  return (
    <Box background="subtle" rounded="md" p="sm">
      <Text size="xs" weight="medium" mode="subtle">
        🔧 Patch Applied
      </Text>
      {patchHash && (
        <Text size="xs" mode="subtle" style={{ fontFamily: "monospace", marginTop: 4 }}>
          Hash: {patchHash.substring(0, 8)}...
        </Text>
      )}
      {patchFiles && Array.isArray(patchFiles) && patchFiles.length > 0 && (
        <Text size="xs" mode="subtle" style={{ marginTop: 4 }}>
          Files: {patchFiles.join(", ")}
        </Text>
      )}
    </Box>
  )
})

PatchRenderer.displayName = "PatchRenderer"
