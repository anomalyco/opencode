import { Option, Schema } from "effect"
import { SessionLegacy } from "@opencode-ai/core/session/legacy"
import { MessageV2 } from "../message-v2"
import { Reference } from "@/reference/reference"

const Source = Schema.Struct({
  value: Schema.String,
  start: Schema.Number,
  end: Schema.Number,
})

export const ReferencePromptMetadata = Schema.Struct({
  name: Schema.String,
  kind: Schema.Literals(["local", "git", "invalid"]),
  path: Schema.optional(Schema.String),
  repository: Schema.optional(Schema.String),
  branch: Schema.optional(Schema.String),
  target: Schema.optional(Schema.String),
  targetPath: Schema.optional(Schema.String),
  problem: Schema.optional(Schema.String),
  source: Source,
})
export type ReferencePromptMetadata = typeof ReferencePromptMetadata.Type

const decodeReferencePromptMetadata = Schema.decodeUnknownOption(ReferencePromptMetadata)

export function referencePromptMetadata(input: unknown) {
  return Option.getOrUndefined(decodeReferencePromptMetadata(input))
}

export function referenceTextPart(input: {
  reference: Reference.Resolved
  source: ReferencePromptMetadata["source"]
  target?: string
  targetPath?: string
  problem?: string
}): SessionLegacy.TextPartInput {
  const metadata: ReferencePromptMetadata = {
    name: input.reference.name,
    kind: input.reference.kind,
    ...(input.reference.kind === "invalid"
      ? { repository: input.reference.repository }
      : { path: input.reference.path }),
    ...(input.reference.kind === "git"
      ? { repository: input.reference.repository, branch: input.reference.branch }
      : {}),
    ...(input.target === undefined ? {} : { target: input.target }),
    ...(input.targetPath ? { targetPath: input.targetPath } : {}),
    problem: input.problem ?? (input.reference.kind === "invalid" ? input.reference.message : undefined),
    source: input.source,
  }
  const label = metadata.target === undefined ? `@${metadata.name}` : `@${metadata.name}/${metadata.target}`
  return {
    type: "text",
    synthetic: true,
    text: [
      `Referenced configured reference ${label}.`,
      ...(metadata.kind === "local" ? ["Kind: local directory"] : []),
      ...(metadata.kind === "git" ? ["Kind: git repository"] : []),
      ...(metadata.repository ? [`Repository: ${metadata.repository}`] : []),
      ...(metadata.branch ? [`Branch/ref: ${metadata.branch}`] : []),
      ...(metadata.path ? [`Reference root: ${metadata.path}`] : []),
      ...(metadata.targetPath ? [`Resolved path: ${metadata.targetPath}`] : []),
      ...(metadata.problem
        ? [`Problem: ${metadata.problem}`]
        : [
            "For targeted context, inspect the reference path directly with Read, Glob, and Grep. For broader research, call the task tool with subagent scout and include this reference path.",
          ]),
    ].join("\n"),
    metadata: { reference: metadata },
  }
}

export * as ReferencePrompt from "./reference"
