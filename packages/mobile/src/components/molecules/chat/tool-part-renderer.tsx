import { memo, useState } from "react"
import { TouchableOpacity } from "react-native"
import { Box, Text, Icon } from "@/components/ui/primitives"
import { ThemedMarked } from "@/components/ui/primitives/marked"
import { Feather } from "@expo/vector-icons"
import {
  ToolStatusIndicator,
  FileContentRenderer,
  BashRenderer,
  TodoListRenderer,
  DiffRenderer,
  WebFetchRenderer,
  GlobRenderer,
  GrepRenderer,
  ListRenderer,
  PatchRenderer,
  TodoReadRenderer,
  TaskRenderer,
} from "./renderers"

interface ToolPartRendererProps {
  part: any
}

export const ToolPartRenderer = memo(
  ({ part }: ToolPartRendererProps) => {
    // Handle patch parts differently since they have different structure
    if (part.type === "patch") {
      const patchHash = part.patchHash
      const patchFiles = part.patchFiles
        ? typeof part.patchFiles === "string"
          ? JSON.parse(part.patchFiles)
          : part.patchFiles
        : null

      if (patchHash || patchFiles) {
        return <PatchRenderer hash={patchHash} files={patchFiles || []} patch={undefined} />
      }
    }

    const toolName = part.toolName || part.tool
    const toolStatus = part.toolStatus || part.state?.status || "pending"
    const toolCallId = part.toolCallId || part.callID
    const toolInput = part.toolInput
      ? typeof part.toolInput === "string"
        ? JSON.parse(part.toolInput)
        : part.toolInput
      : part.state?.input
    const toolOutput = part.toolOutput || part.state?.output
    const toolMetadata = part.toolMetadata
      ? typeof part.toolMetadata === "string"
        ? JSON.parse(part.toolMetadata)
        : part.toolMetadata
      : part.state?.metadata
    const toolError = part.toolError || part.state?.error
    const toolTitle = part.toolTitle || part.state?.title

    const toolTimeStart = part.toolTimeStart || (part.state?.time?.start ? new Date(part.state.time.start) : null)
    const toolTimeEnd = part.toolTimeEnd || (part.state?.time?.end ? new Date(part.state.time.end) : null)

    const executionTime = toolTimeStart && toolTimeEnd ? toolTimeEnd.getTime() - toolTimeStart.getTime() : null

    if (toolStatus === "pending" || toolStatus === "running") {
      const displayName = toolTitle || toolName || "Working..."
      const statusText =
        toolStatus === "running" && executionTime
          ? `${displayName} (${Math.round(executionTime / 1000)}s)`
          : displayName
      return <ToolStatusIndicator status={toolStatus} toolName={statusText} />
    }

    if (!toolName && !toolOutput && !toolError) {
      return (
        <Box background="subtle" rounded="md" p="sm">
          <Text size="xs" weight="medium" mode="subtle">
            Tool call in progress...
          </Text>
        </Box>
      )
    }

    if (toolStatus === "error" && toolError) {
      const displayName = toolTitle || toolName || "Tool"
      const errorHeader = `**Error in ${displayName}:**`
      const errorDetails = toolCallId ? `\n\n*Call ID: ${toolCallId}*` : ""
      const timingInfo = executionTime ? `\n*Duration: ${Math.round(executionTime / 1000)}s*` : ""

      return (
        <Box background="lighter" rounded="md" p="sm" mode="error">
          <ThemedMarked value={`${errorHeader} ${toolError}${errorDetails}${timingInfo}`} />
        </Box>
      )
    }

    switch (toolName) {
      case "read":
        if (toolMetadata?.preview && toolInput?.filePath) {
          return <FileContentRenderer filename={toolInput.filePath} content={toolMetadata.preview} truncateLines={6} />
        }
        break

      case "edit":
        if (toolMetadata?.diff && toolInput?.filePath) {
          return <DiffRenderer filename={toolInput.filePath} diff={toolMetadata.diff} />
        }
        break

      case "write":
        if (toolInput?.filePath && toolInput?.content) {
          return <FileContentRenderer filename={toolInput.filePath} content={toolInput.content} />
        }
        break

      case "bash":
        if (toolInput?.command) {
          return (
            <BashRenderer command={toolInput.command} stdout={toolMetadata?.stdout} stderr={toolMetadata?.stderr} />
          )
        }
        break

      case "todowrite":
        if (toolMetadata?.todos) {
          return <TodoListRenderer todos={toolMetadata.todos} />
        }
        break

      case "webfetch":
        if (toolInput?.url && toolOutput) {
          return <WebFetchRenderer url={toolInput.url} content={toolOutput} format={toolInput.format || "text"} />
        }
        break

      default:
        if (toolOutput) {
          return <GenericToolOutputRenderer toolName={toolName} toolOutput={toolOutput} />
        }

        if (toolName && toolStatus === "completed") {
          const displayName = toolTitle || toolName
          const timingText = executionTime ? ` (${Math.round(executionTime / 1000)}s)` : ""

          return (
            <Box background="subtle" rounded="md" p="sm">
              <Text size="xs" weight="medium" mode="subtle">
                ✓ {displayName}
                {timingText}
              </Text>
              {toolCallId && (
                <Text size="xs" mode="subtle" style={{ opacity: 0.6, marginTop: 2 }}>
                  {toolCallId}
                </Text>
              )}
            </Box>
          )
        }
    }

    return null
  },
  (prevProps, nextProps) => {
    const prev = prevProps.part
    const next = nextProps.part

    return (
      prev.toolName === next.toolName &&
      prev.toolStatus === next.toolStatus &&
      prev.toolOutput === next.toolOutput &&
      prev.toolError === next.toolError &&
      prev.toolMetadata === next.toolMetadata &&
      prev.toolInput === next.toolInput
    )
  },
)

ToolPartRenderer.displayName = "ToolPartRenderer"

const GenericToolOutputRenderer = memo(
  ({ toolName, toolOutput }: { toolName: string; toolOutput: string }) => {
    const [isExpanded, setIsExpanded] = useState(false)

    const needsExpansion = ["task", "glob", "grep", "list"].includes(toolName) && toolOutput.length > 200

    if (!needsExpansion) {
      return (
        <Box background="subtle" rounded="md" p="sm">
          <Box mb="xs">
            <Text size="xs" weight="medium" mode="subtle">
              {toolName || "Tool"}
            </Text>
          </Box>
          <Text size="xs" mode="subtle" style={{ fontFamily: "monospace", lineHeight: 16 }}>
            {toolOutput}
          </Text>
        </Box>
      )
    }

    return (
      <Box background="subtle" rounded="md" p="sm">
        <Box mb="xs">
          <Text size="xs" weight="medium" mode="subtle">
            {toolName || "Tool"}
          </Text>
        </Box>
        <Box style={{ maxHeight: isExpanded ? undefined : 100, overflow: "hidden" }}>
          <Text size="sm" mode="subtle" style={{ fontFamily: "monospace", lineHeight: 18 }}>
            {toolOutput}
          </Text>
        </Box>
        <TouchableOpacity onPress={() => setIsExpanded(!isExpanded)} style={{ marginTop: 8 }}>
          <Box direction="row" center gap="xs" p="xs">
            <Text size="xs" mode="subtle" weight="medium">
              {isExpanded ? "Show less" : "Show more"}
            </Text>
            <Icon icon={Feather} name={isExpanded ? "chevron-up" : "chevron-down"} size={12} color="muted" />
          </Box>
        </TouchableOpacity>
      </Box>
    )
  },
  (prevProps, nextProps) => {
    return prevProps.toolName === nextProps.toolName && prevProps.toolOutput === nextProps.toolOutput
  },
)

GenericToolOutputRenderer.displayName = "GenericToolOutputRenderer"
