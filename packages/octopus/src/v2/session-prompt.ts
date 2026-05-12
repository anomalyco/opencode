import * as Schema from "effect/Schema"

export class Source extends Schema.Class<Source>("Prompt.Source")({
  start: Schema.Finite,
  end: Schema.Finite,
  text: Schema.String,
}) {}

export class FileAttachment extends Schema.Class<FileAttachment>("Prompt.FileAttachment")({
  uri: Schema.String,
  mime: Schema.String,
  name: Schema.String.pipe(Schema.optional),
  description: Schema.String.pipe(Schema.optional),
  source: Source.pipe(Schema.optional),
}) {
  static create(input: FileAttachment) {
    return new FileAttachment({
      uri: input.uri,
      mime: input.mime,
      name: input.name,
      description: input.description,
      source: input.source,
    })
  }
}

export class AgentAttachment extends Schema.Class<AgentAttachment>("Prompt.AgentAttachment")({
  name: Schema.String,
  source: Source.pipe(Schema.optional),
}) {}

export class Prompt extends Schema.Class<Prompt>("Prompt")({
  text: Schema.String,
  files: Schema.Array(FileAttachment).pipe(Schema.optional),
  agents: Schema.Array(AgentAttachment).pipe(Schema.optional),
}) {}
