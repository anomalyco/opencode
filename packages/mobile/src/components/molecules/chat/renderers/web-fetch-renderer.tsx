import React from "react"
import { Box, Text, Icon } from "@/components/ui/primitives"
import { ThemedMarked } from "@/components/ui/primitives/marked"
import { Feather } from "@expo/vector-icons"

interface WebFetchRendererProps {
  url: string
  content: string
  format: "text" | "markdown" | "html"
}

export const WebFetchRenderer: React.FC<WebFetchRendererProps> = ({ url, content, format }) => {
  const truncatedContent = content.length > 1000 ? content.slice(0, 1000) + "..." : content

  return (
    <Box background="dim" rounded="lg" p="sm" gap="xs" mode="secondary">
      <Box direction="row" alignItems="center" gap="xs" pb="xs">
        <Icon icon={Feather} name="globe" size={14} color="brand" />
        <Text size="sm" weight="medium" style={{ flex: 1 }} numberOfLines={1} ellipsizeMode="middle">
          {url}
        </Text>
      </Box>
      {format === "markdown" || format === "html" ? (
        <ThemedMarked value={truncatedContent} />
      ) : (
        <Text size="sm" mode="subtle">
          {truncatedContent}
        </Text>
      )}
    </Box>
  )
}
