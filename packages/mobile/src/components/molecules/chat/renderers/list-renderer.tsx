import React, { useState } from "react"
import { TouchableOpacity } from "react-native"
import { Box, Text, Icon } from "@/components/ui/primitives"
import { Feather } from "@expo/vector-icons"

interface ListItem {
  name: string
  type: "file" | "directory"
  size?: number
  modified?: string
}

interface ListRendererProps {
  path: string
  items: ListItem[]
}

export const ListRenderer: React.FC<ListRendererProps> = ({ path, items }) => {
  const [isExpanded, setIsExpanded] = useState(false)
  const itemCount = items.length
  const needsExpansion = itemCount > 8

  const displayItems = needsExpansion && !isExpanded ? items.slice(0, 8) : items

  const getFileIcon = (item: ListItem) => {
    if (item.type === "directory") return "folder"
    const ext = item.name.split(".").pop()?.toLowerCase()
    switch (ext) {
      case "js":
      case "ts":
      case "jsx":
      case "tsx":
        return "code"
      case "json":
        return "file-text"
      case "md":
        return "book-open"
      case "png":
      case "jpg":
      case "jpeg":
      case "gif":
        return "image"
      default:
        return "file"
    }
  }

  const formatSize = (bytes?: number) => {
    if (!bytes) return ""
    if (bytes < 1024) return `${bytes}B`
    if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)}KB`
    return `${Math.round(bytes / (1024 * 1024))}MB`
  }

  return (
    <Box background="darker" rounded="lg" p="sm" gap="xs" mode="secondary">
      <Box direction="row" alignItems="center" gap="xs" pb="xs">
        <Icon icon={Feather} name="folder" size={14} color="info" />
        <Text size="sm" weight="medium" mode="subtle">
          {itemCount} item{itemCount !== 1 ? "s" : ""} in {path}
        </Text>
      </Box>

      <Box gap="xs">
        {displayItems.map((item, index) => (
          <Box key={index} direction="row" alignItems="center" gap="xs" p="xs">
            <Icon
              icon={Feather}
              name={getFileIcon(item)}
              size={12}
              color={item.type === "directory" ? "info" : "muted"}
            />
            <Box style={{ flex: 1 }}>
              <Text
                size="xs"
                mode="subtle"
                weight={item.type === "directory" ? "medium" : "regular"}
                style={{ fontFamily: "monospace" }}
              >
                {item.name}
              </Text>
            </Box>{" "}
            {item.size && (
              <Text size="xs" mode="subtle" style={{ opacity: 0.6 }}>
                {formatSize(item.size)}
              </Text>
            )}
          </Box>
        ))}
      </Box>

      {needsExpansion && (
        <TouchableOpacity onPress={() => setIsExpanded(!isExpanded)} style={{ marginTop: 8 }}>
          <Box direction="row" center gap="xs" p="xs">
            <Text size="xs" mode="subtle" weight="medium">
              {isExpanded ? "Show less" : `Show ${itemCount - 8} more items`}
            </Text>
            <Icon icon={Feather} name={isExpanded ? "chevron-up" : "chevron-down"} size={12} color="muted" />
          </Box>
        </TouchableOpacity>
      )}
    </Box>
  )
}
