import { memo, useMemo } from "react"
import { Box } from "@/components/ui/primitives"
import { ThemedMarked } from "@/components/ui/primitives/marked"
import { ToolPartRenderer } from "./tool-part-renderer"
import { FilePartRenderer } from "./file-part-renderer"

interface MessagePartRendererProps {
  part: any
}

export const MessagePartRenderer = memo(
  ({ part }: MessagePartRendererProps) => {
    const isUser = part.role === "user"
    const partData = part.data

    const partType = useMemo(() => {
      return partData.type || (partData.toolName ? "tool" : partData.fileFilename ? "file" : "text")
    }, [partData])

    const isShortMessage = useMemo(() => {
      return (
        partType === "text" &&
        partData.textContent &&
        partData.textContent.length < 100 &&
        partData.textContent.split("\n").length <= 2
      )
    }, [partType, partData])

    const isVeryShortMessage = useMemo(() => {
      return (
        partType === "text" &&
        partData.textContent &&
        partData.textContent.length < 20 &&
        partData.textContent.split("\n").length === 1
      )
    }, [partType, partData])

    const isTodoMessage = useMemo(() => {
      return partData.toolName === "todowrite" || partData.toolName === "todoread"
    }, [partData])

    const isDiffMessage = useMemo(() => {
      return partData.toolName === "edit"
    }, [partData])

    const shouldRender = useMemo(() => {
      if (partType === "text") {
        return !partData.isSynthetic && partData.textContent && !partData.textContent.includes("<system-reminder>")
      }
      if (partType === "step-start" || partType === "step-finish") {
        return false
      }
      return true
    }, [partType, partData])

    const content = useMemo(() => {
      if (!shouldRender) return null

      switch (partType) {
        case "text":
          return <ThemedMarked value={partData.textContent} />

        case "tool":
          return <ToolPartRenderer part={partData} />

        case "patch":
          return <ToolPartRenderer part={partData} />

        case "file":
        case "snapshot":
          return <FilePartRenderer part={partData} type={partType} />

        default:
          return null
      }
    }, [shouldRender, partType, partData])

    if (!shouldRender || !content) {
      return null
    }

    return (
      <Box p="sm">
        <Box direction="row" justifyContent={isUser ? "flex-end" : "flex-start"}>
          <Box
            background={isUser ? "emphasis" : "lightest"}
            rounded="lg"
            p={partType === "tool" || partType === "patch" ? undefined : isShortMessage ? "sm" : "md"}
            style={{
              maxWidth: "85%",
              minWidth: isTodoMessage
                ? "70%"
                : isDiffMessage
                  ? "85%"
                  : isVeryShortMessage
                    ? "auto"
                    : partType === "text"
                      ? "40%"
                      : "20%",
              shadowColor: "#000",
              shadowOffset: { width: 0, height: 1 },
              shadowOpacity: 0.05,
              shadowRadius: 2,
              elevation: 1,
            }}
          >
            {content}
          </Box>
        </Box>
      </Box>
    )
  },
  (prevProps, nextProps) => {
    const prev = prevProps.part.data
    const next = nextProps.part.data

    if (prev.type !== next.type) return false

    if (prev.type === "text" && prev.textContent !== next.textContent) return false

    if (prev.type === "tool") {
      return (
        prev.toolStatus === next.toolStatus &&
        prev.toolOutput === next.toolOutput &&
        prev.toolError === next.toolError &&
        prev.toolMetadata === next.toolMetadata
      )
    }

    if (prev.type === "file") {
      return prev.fileFilename === next.fileFilename && prev.fileUrl === next.fileUrl
    }

    return true
  },
)

MessagePartRenderer.displayName = "MessagePartRenderer"
