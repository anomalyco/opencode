import React, { useState } from "react"
import { TouchableOpacity } from "react-native"
import { Box, Text, Icon } from "@/components/ui/primitives"
import { ThemedMarked } from "@/components/ui/primitives/marked"
import { Feather } from "@expo/vector-icons"

interface TaskRendererProps {
  description: string
  prompt: string
  subagentType?: string
  result?: string
}

export const TaskRenderer: React.FC<TaskRendererProps> = ({ description, prompt, subagentType, result }) => {
  const [isExpanded, setIsExpanded] = useState(false)
  const needsExpansion = prompt.length > 200 || (result && result.length > 300)

  return (
    <Box background="darker" rounded="lg" p="sm" gap="xs" mode="secondary">
      <Box direction="row" alignItems="center" gap="xs" pb="xs">
        <Icon icon={Feather} name="cpu" size={14} color="info" />
        <Text size="sm" weight="medium" mode="subtle">
          Agent Task: {description}
        </Text>
      </Box>

      {subagentType && (
        <Box direction="row" alignItems="center" gap="xs" pb="xs">
          <Icon icon={Feather} name="user" size={12} color="muted" />
          <Text size="xs" mode="subtle">
            Agent Type: {subagentType}
          </Text>
        </Box>
      )}

      <Box gap="xs">
        <Text size="xs" mode="subtle" weight="medium">
          Task Prompt:
        </Text>
        <Box
          background="subtle"
          rounded="sm"
          p="xs"
          style={{ maxHeight: needsExpansion && !isExpanded ? 100 : undefined, overflow: "hidden" }}
        >
          <Text size="xs" mode="subtle" style={{ fontFamily: "monospace", lineHeight: 16 }}>
            {prompt}
          </Text>
        </Box>
      </Box>

      {result && (
        <Box gap="xs">
          <Text size="xs" mode="subtle" weight="medium">
            Agent Response:
          </Text>
          <Box
            background="subtle"
            rounded="sm"
            p="xs"
            style={{ maxHeight: needsExpansion && !isExpanded ? 150 : undefined, overflow: "hidden" }}
          >
            <ThemedMarked value={result} />
          </Box>
        </Box>
      )}

      {needsExpansion && (
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
