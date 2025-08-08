import React, { useState } from "react"
import { TouchableOpacity } from "react-native"
import { Box, Text, Icon } from "@/components/ui/primitives"
import { ThemedMarked } from "@/components/ui/primitives/marked"
import { Feather } from "@expo/vector-icons"

interface BashRendererProps {
  command: string
  stdout?: string
  stderr?: string
}

export const BashRenderer: React.FC<BashRendererProps> = ({ command, stdout, stderr }) => {
  const [isExpanded, setIsExpanded] = useState(false)
  const output = [stdout, stderr].filter(Boolean).join("\n").trim()

  const needsExpansion = output.length > 200
  const markdownContent = `\`\`\`console\n$ ${command}${output ? "\n" + output : ""}\n\`\`\``

  return (
    <Box background="darker" rounded="lg" p="sm" gap="xs" mode="secondary">
      <Box direction="row" alignItems="center" gap="xs" pb="xs">
        <Icon icon={Feather} name="terminal" size={14} color="success" />
        <Text size="sm" weight="medium" mode="subtle">
          Command
        </Text>
      </Box>
      <Box style={{ maxHeight: needsExpansion && !isExpanded ? 100 : undefined, overflow: "hidden" }}>
        <ThemedMarked value={markdownContent} />
      </Box>
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
