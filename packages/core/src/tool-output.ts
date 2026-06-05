export * as ToolOutput from "./tool-output"
export {
  ToolContent as Content,
  ToolFileContent as FileContent,
  ToolTextContent as TextContent,
  toolFile as file,
  toolText as text,
} from "@opencode-ai/llm"
import { Schema } from "effect"

export const Structured = Schema.Record(Schema.String, Schema.Any)
