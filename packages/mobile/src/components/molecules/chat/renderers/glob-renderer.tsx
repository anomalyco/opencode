import React, { useState } from "react"
import { TouchableOpacity } from "react-native"
import { Box, Text, Icon } from "@/components/ui/primitives"
import { Feather } from "@expo/vector-icons"

interface GlobRendererProps {
  pattern: string
  files: string[]
}

export const GlobRenderer: React.FC<GlobRendererProps> = ({ pattern, files }) => {
  const [isExpanded, setIsExpanded] = useState(false)
  const fileCount = files.length
  const needsExpansion = fileCount > 5

  const displayFiles = needsExpansion && !isExpanded ? files.slice(0, 5) : files

  return (
    <Box background="darker" rounded="lg" p="sm" gap="xs" mode="secondary">
      <Box direction="row" alignItems="center" gap="xs" pb="xs">
        <Icon icon={Feather} name="search" size={14} color="info" />
        <Text size="sm" weight="medium" mode="subtle">
          Found {fileCount} file{fileCount !== 1 ? "s" : ""} matching "{pattern}"
        </Text>
      </Box>

      <Box gap="xs">
        {displayFiles.map((file, index) => (
          <Box key={index} direction="row" alignItems="center" gap="xs">
            <Icon icon={Feather} name="file" size={12} color="muted" />
            <Text size="xs" mode="subtle" style={{ fontFamily: "monospace" }}>
              {file}
            </Text>
          </Box>
        ))}
      </Box>

      {needsExpansion && (
        <TouchableOpacity onPress={() => setIsExpanded(!isExpanded)} style={{ marginTop: 8 }}>
          <Box direction="row" center gap="xs" p="xs">
            <Text size="xs" mode="subtle" weight="medium">
              {isExpanded ? "Show less" : `Show ${fileCount - 5} more files`}
            </Text>
            <Icon icon={Feather} name={isExpanded ? "chevron-up" : "chevron-down"} size={12} color="muted" />
          </Box>
        </TouchableOpacity>
      )}
    </Box>
  )
}
