export * as ToolOutput from "./tool-output"
import { Schema } from "effect"

export class TextContent extends Schema.Class<TextContent>("Tool.TextContent")({
  type: Schema.Literal("text"),
  text: Schema.String,
}) {}

export class FileContent extends Schema.Class<FileContent>("Tool.FileContent")({
  type: Schema.Literal("file"),
  uri: Schema.String,
  mime: Schema.String,
  name: Schema.String.pipe(Schema.optional),
}) {}

export const Content = Schema.Union([TextContent, FileContent]).pipe(Schema.toTaggedUnion("type"))

export const Structured = Schema.Record(Schema.String, Schema.Any)
