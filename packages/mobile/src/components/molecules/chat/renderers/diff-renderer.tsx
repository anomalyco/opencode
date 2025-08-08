import React, { memo, useMemo, useState } from "react"
import { ScrollView, TouchableOpacity } from "react-native"
import { Box, Text, Icon } from "@/components/ui/primitives"
import { Feather } from "@expo/vector-icons"
import { useUnistyles } from "react-native-unistyles"

interface DiffLine {
  type: "addition" | "deletion" | "context" | "header" | "hunk"
  content: string
  lineNumber?: number
  oldLineNumber?: number
  newLineNumber?: number
}

interface DiffRendererProps {
  filename: string
  diff: string
  maxLines?: number
  showLineNumbers?: boolean
}

// Optimized diff parsing with memoization
const parseDiff = (diff: string): DiffLine[] => {
  const lines = diff.split("\n")
  const parsedLines: DiffLine[] = []

  let oldLineNumber = 0
  let newLineNumber = 0

  for (const line of lines) {
    if (line.startsWith("@@")) {
      // Hunk header - extract line numbers
      const match = line.match(/@@ -(\d+),?\d* \+(\d+),?\d* @@/)
      if (match) {
        oldLineNumber = parseInt(match[1], 10)
        newLineNumber = parseInt(match[2], 10)
      }
      parsedLines.push({
        type: "hunk",
        content: line,
      })
    } else if (line.startsWith("+++") || line.startsWith("---")) {
      // File headers
      parsedLines.push({
        type: "header",
        content: line,
      })
    } else if (line.startsWith("+")) {
      // Addition
      parsedLines.push({
        type: "addition",
        content: line.slice(1), // Remove the + prefix
        newLineNumber: newLineNumber++,
      })
    } else if (line.startsWith("-")) {
      // Deletion
      parsedLines.push({
        type: "deletion",
        content: line.slice(1), // Remove the - prefix
        oldLineNumber: oldLineNumber++,
      })
    } else if (line.startsWith(" ") || line === "") {
      // Context line
      parsedLines.push({
        type: "context",
        content: line.slice(1), // Remove the space prefix
        oldLineNumber: oldLineNumber++,
        newLineNumber: newLineNumber++,
      })
    }
  }

  return parsedLines
}

// Memoized line component for performance
const DiffLineComponent = memo(
  ({ line, showLineNumbers, theme }: { line: DiffLine; showLineNumbers: boolean; theme: any }) => {
    const getLineStyle = () => {
      switch (line.type) {
        case "addition":
          return {
            backgroundColor: `${theme.colors.success[500]}20`,
            borderLeftColor: theme.colors.success[500],
            borderLeftWidth: 3,
          }
        case "deletion":
          return {
            backgroundColor: `${theme.colors.error[500]}20`,
            borderLeftColor: theme.colors.error[500],
            borderLeftWidth: 3,
          }
        case "context":
          return {
            backgroundColor: "transparent",
          }
        case "hunk":
          return {
            backgroundColor: theme.colors.background.subtle,
            borderLeftColor: theme.colors.border.default,
            borderLeftWidth: 1,
          }
        case "header":
          return {
            backgroundColor: theme.colors.background.dim,
          }
        default:
          return {}
      }
    }

    const getTextColor = () => {
      switch (line.type) {
        case "addition":
          return theme.colors.success[600]
        case "deletion":
          return theme.colors.error[600]
        case "hunk":
          return theme.colors.text.subtle
        case "header":
          return theme.colors.text.muted
        default:
          return theme.colors.text.default
      }
    }

    const getLinePrefix = () => {
      switch (line.type) {
        case "addition":
          return "+"
        case "deletion":
          return "-"
        case "context":
          return " "
        default:
          return ""
      }
    }

    if (line.type === "header") {
      return null // Skip file headers for cleaner display
    }

    return (
      <Box direction="row" style={getLineStyle()} p="xs" alignItems="flex-start">
        {showLineNumbers && (
          <Box direction="row" pl="xs" pr="xs">
            {line.type !== "context" ? (
              <Text size="xs" mode="error">
                {line.oldLineNumber || ""}
              </Text>
            ) : null}
            <Text size="xs" mode={line.type === "context" ? "subtle" : "success"}>
              {line.newLineNumber || ""}
            </Text>
          </Box>
        )}

        <Text
          size="xs"
          style={{
            color: getTextColor(),
          }}
        >
          {getLinePrefix()}
          {line.content || " "}
        </Text>
      </Box>
    )
  },
)

DiffLineComponent.displayName = "DiffLineComponent"

export const DiffRenderer: React.FC<DiffRendererProps> = memo(({ filename, diff, showLineNumbers = true }) => {
  const { theme } = useUnistyles()
  const [isExpanded, setIsExpanded] = useState(false)

  // Memoize parsed diff for performance
  const parsedLines = useMemo(() => parseDiff(diff), [diff])

  return (
    <Box background="lighter" rounded="lg" p="sm" gap="xs" mode="success">
      {/* Header */}
      <Box direction="row" alignItems="center" gap="xs" pb="xs">
        <Icon icon={Feather} name="edit-3" size={14} color="success" />
        <Text size="sm" weight="medium" style={{ flex: 1 }} numberOfLines={1} ellipsizeMode="head">
          {filename}
        </Text>
        {showLineNumbers && (
          <TouchableOpacity onPress={() => setIsExpanded(!isExpanded)}>
            <Icon icon={Feather} name="hash" size={12} color="muted" />
          </TouchableOpacity>
        )}
      </Box>

      {/* Diff content */}
      <Box background="base" rounded="md">
        <ScrollView showsVerticalScrollIndicator={false} scrollEnabled={true}>
          {parsedLines.map((line, index) => (
            <DiffLineComponent
              key={`${index}-${line.type}-${line.content.slice(0, 10)}`}
              line={line}
              showLineNumbers={showLineNumbers}
              theme={theme}
            />
          ))}
        </ScrollView>
      </Box>
    </Box>
  )
})

DiffRenderer.displayName = "DiffRenderer"
