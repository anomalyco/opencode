import React, { useState } from "react"
import { TouchableOpacity } from "react-native"
import { Box, Text, Icon } from "@/components/ui/primitives"
import { ThemedMarked } from "@/components/ui/primitives/marked"
import { Feather } from "@expo/vector-icons"

interface PatchRendererProps {
  hash?: string
  files: string[]
  patch?: string
}

export const PatchRenderer: React.FC<PatchRendererProps> = ({ hash, files, patch }) => {
  const [isExpanded, setIsExpanded] = useState(false)
  const fileCount = files.length
  const needsExpansion = patch && patch.length > 300

  const displayFiles = fileCount > 5 && !isExpanded ? files.slice(0, 5) : files

  return (
    <Box background="darker" rounded="lg" p="sm" gap="xs" mode="secondary">
      <Box direction="row" alignItems="center" gap="xs" pb="xs">
        <Icon icon={Feather} name="edit-3" size={14} color="success" />
        <Text size="sm" weight="medium" mode="subtle">
          Patch Applied {hash && `(${hash.slice(0, 8)})`}
        </Text>
      </Box>

      <Box gap="xs">
        <Text size="xs" mode="subtle" weight="medium">
          {fileCount} file{fileCount !== 1 ? "s" : ""} changed:
        </Text>

        {displayFiles.map((file, index) => (
          <Box key={index} direction="row" alignItems="center" gap="xs" pl="sm">
            <Icon icon={Feather} name="file" size={10} color="muted" />
            <Text size="xs" mode="subtle" style={{ fontFamily: "monospace" }}>
              {file}
            </Text>
          </Box>
        ))}

        {fileCount > 5 && !isExpanded && (
          <Text size="xs" mode="subtle" style={{ opacity: 0.6, paddingLeft: 16 }}>
            ... and {fileCount - 5} more files
          </Text>
        )}
      </Box>

      {patch && (
        <Box gap="xs">
          <Text size="xs" mode="subtle" weight="medium">
            Diff:
          </Text>
          <Box
            background="subtle"
            rounded="sm"
            p="xs"
            style={{ maxHeight: needsExpansion && !isExpanded ? 150 : undefined, overflow: "hidden" }}
          >
            <ThemedMarked value={`\`\`\`diff\n${patch}\n\`\`\``} />
          </Box>
        </Box>
      )}

      {(needsExpansion || fileCount > 5) && (
        <TouchableOpacity onPress={() => setIsExpanded(!isExpanded)} style={{ marginTop: 8 }}>
          <Box direction="row" center gap="xs" p="xs">
            <Text size="xs" mode="subtle" weight="medium">
              {isExpanded ? "Show less" : "Show more"}
            </Text>
            <Icon icon={Feather} name={isExpanded ? "chevron-up" : "chevron-down"} size={12} color="muted" />
          </Box>
        </TouchableOpacity>
      )}
    </Box>
  )
}
