import React from "react"
import { Box, Text, Icon } from "@/components/ui/primitives"
import { ThemedMarked } from "@/components/ui/primitives/marked"
import { Feather } from "@expo/vector-icons"

interface FileContentRendererProps {
  filename: string
  content: string
  truncateLines?: number
}

export const FileContentRenderer: React.FC<FileContentRendererProps> = ({ filename, content, truncateLines }) => {
  const getFileExtension = (path: string): string => {
    const ext = path.split(".").pop()
    return ext ? ext.toLowerCase() : ""
  }

  const processContent = (content: string): string => {
    let lines = content.split("\n")

    // Truncate if specified
    if (truncateLines && lines.length > truncateLines) {
      lines = lines.slice(0, truncateLines)
      lines.push("...")
    }

    // Clean up whitespace and tabs
    lines = lines.map((line) => line.trimEnd().replace(/\t/g, "  "))

    return lines.join("\n")
  }

  const processedContent = processContent(content)
  const extension = getFileExtension(filename)
  const markdownContent = `\`\`\`${extension}\n${processedContent}\n\`\`\``

  return (
    <Box background="lighter" rounded="lg" p="sm" gap="xs" mode="primary">
      <Box direction="row" alignItems="center" gap="xs" pb="xs">
        <Icon icon={Feather} name="file-text" size={14} color="accent" />
        <Text size="sm" weight="medium" style={{ flex: 1 }} numberOfLines={1} ellipsizeMode="head">
          {filename}
        </Text>
      </Box>
      <ThemedMarked value={markdownContent} />
    </Box>
  )
}
