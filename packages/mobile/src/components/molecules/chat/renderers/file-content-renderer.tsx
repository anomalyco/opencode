import React, { useState } from "react"
import { TouchableOpacity } from "react-native"
import { Box, Text, Icon } from "@/components/ui/primitives"
import { ThemedMarked } from "@/components/ui/primitives/marked"
import { Feather } from "@expo/vector-icons"

interface FileContentRendererProps {
  filename: string
  content: string
  truncateLines?: number
}

export const FileContentRenderer: React.FC<FileContentRendererProps> = ({
  filename,
  content,
  truncateLines = 10, // Default to 10 lines
}) => {
  const [isExpanded, setIsExpanded] = useState(false)

  const getFileExtension = (path: string): string => {
    const ext = path.split(".").pop()
    return ext ? ext.toLowerCase() : ""
  }

  const processContent = (content: string, shouldTruncate: boolean): { content: string; wasTruncated: boolean } => {
    let lines = content.split("\n")
    let wasTruncated = false

    // Truncate if specified and not expanded
    if (shouldTruncate && !isExpanded && lines.length > truncateLines) {
      lines = lines.slice(0, truncateLines)
      wasTruncated = true
    }

    // Clean up whitespace and tabs
    lines = lines.map((line) => line.trimEnd().replace(/\t/g, "  "))

    return {
      content: lines.join("\n"),
      wasTruncated,
    }
  }

  const originalLines = content.split("\n")
  const needsExpansion = originalLines.length > truncateLines
  const { content: processedContent } = processContent(content, needsExpansion)

  const extension = getFileExtension(filename)
  const markdownContent = `\`\`\`${extension}\n${processedContent}\n\`\`\``

  return (
    <Box background="lighter" rounded="lg" p="sm" gap="xs" mode="primary">
      <Box direction="row" alignItems="center" gap="xs" pb="xs">
        <Icon icon={Feather} name="file-text" size={14} color="accent" />
        <Text size="sm" weight="medium" style={{ flex: 1 }} numberOfLines={1} ellipsizeMode="head">
          {filename}
        </Text>
        {needsExpansion && (
          <Text size="xs" mode="subtle">
            {originalLines.length} lines
          </Text>
        )}
      </Box>

      <ThemedMarked value={markdownContent} />

      {needsExpansion && (
        <TouchableOpacity onPress={() => setIsExpanded(!isExpanded)} style={{ marginTop: 8 }}>
          <Box direction="row" center gap="xs" p="xs">
            <Text size="xs" mode="subtle" weight="medium">
              {isExpanded ? "Show less" : `Show ${originalLines.length - truncateLines} more lines`}
            </Text>
            <Icon icon={Feather} name={isExpanded ? "chevron-up" : "chevron-down"} size={12} color="muted" />
          </Box>
        </TouchableOpacity>
      )}
    </Box>
  )
}
