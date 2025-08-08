import React, { useState } from "react"
import { TouchableOpacity } from "react-native"
import { Box, Text, Icon } from "@/components/ui/primitives"
import { Feather } from "@expo/vector-icons"

interface GrepMatch {
  path: { text: string }
  lines: { text: string }
  line_number: number
  submatches: Array<{
    match: { text: string }
    start: number
    end: number
  }>
}

interface GrepRendererProps {
  pattern: string
  matches: GrepMatch[]
}

export const GrepRenderer: React.FC<GrepRendererProps> = ({ pattern, matches }) => {
  const [isExpanded, setIsExpanded] = useState(false)
  const matchCount = matches.length
  const needsExpansion = matchCount > 3

  const displayMatches = needsExpansion && !isExpanded ? matches.slice(0, 3) : matches

  const highlightMatch = (text: string, submatches: GrepMatch["submatches"]) => {
    if (!submatches.length) return text

    let result = text
    // Sort by start position in reverse to avoid offset issues
    const sortedMatches = [...submatches].sort((a, b) => b.start - a.start)

    sortedMatches.forEach((submatch) => {
      const before = result.slice(0, submatch.start)
      const match = result.slice(submatch.start, submatch.end)
      const after = result.slice(submatch.end)
      result = before + `**${match}**` + after
    })

    return result
  }

  return (
    <Box background="darker" rounded="lg" p="sm" gap="xs" mode="secondary">
      <Box direction="row" alignItems="center" gap="xs" pb="xs">
        <Icon icon={Feather} name="search" size={14} color="warning" />
        <Text size="sm" weight="medium" mode="subtle">
          Found {matchCount} match{matchCount !== 1 ? "es" : ""} for "{pattern}"
        </Text>
      </Box>

      <Box gap="sm">
        {displayMatches.map((match, index) => (
          <Box key={index} gap="xs">
            <Box direction="row" alignItems="center" gap="xs">
              <Icon icon={Feather} name="file-text" size={12} color="info" />
              <Text size="xs" weight="medium" mode="subtle" style={{ fontFamily: "monospace" }}>
                {match.path.text}:{match.line_number}
              </Text>
            </Box>
            <Box pl="md" background="subtle" rounded="sm" p="xs">
              <Text size="xs" mode="subtle" style={{ fontFamily: "monospace", lineHeight: 16 }}>
                {highlightMatch(match.lines.text, match.submatches)}
              </Text>
            </Box>
          </Box>
        ))}
      </Box>

      {needsExpansion && (
        <TouchableOpacity onPress={() => setIsExpanded(!isExpanded)} style={{ marginTop: 8 }}>
          <Box direction="row" center gap="xs" p="xs">
            <Text size="xs" mode="subtle" weight="medium">
              {isExpanded ? "Show less" : `Show ${matchCount - 3} more matches`}
            </Text>
            <Icon icon={Feather} name={isExpanded ? "chevron-up" : "chevron-down"} size={12} color="muted" />
          </Box>
        </TouchableOpacity>
      )}
    </Box>
  )
}
