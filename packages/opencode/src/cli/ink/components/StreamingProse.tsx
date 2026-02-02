/** @jsxImportSource react */
import { Text } from "ink"

interface StreamingProseProps {
  text: string
  isStreaming?: boolean
}

export const StreamingProse = ({ text, isStreaming = false }: StreamingProseProps) => (
  <Text>
    {text}
    {isStreaming && <Text dimColor>▋</Text>}
  </Text>
)
