export * as ArtifactTools from "./artifact.js"

import { ToolFailure } from "@opencode/ai/effect"
import type { Context } from "@opencode/plugin/effect/plugin"
import { optional } from "@opencode/schema/schema"
import { Effect, Schema, Stream } from "effect"
import { Artifact } from "../../artifact.js"
import { Config } from "../../config.js"
import { ConfigEntryObserver } from "../../config/plugin/entry-observer.js"

export const CreateToolInput = Schema.Struct({
  title: Schema.String.annotate({ description: "Human-readable artifact title." }),
  files: Schema.Record(Schema.String, Schema.String).annotate({
    description: "UTF-8 file map keyed by relative path (for example index.html and assets/app.js).",
  }),
  entry: Schema.String.pipe(optional).annotate({
    description: "Entry file path relative to the artifact root. Defaults to index.html, index.md, or the sole file.",
  }),
  provider: Schema.String.pipe(optional).annotate({
    description: "Artifact provider ID to override the default provider for this request.",
  }),
})

export const ReadToolInput = Schema.Struct({
  id: Artifact.ID.annotate({ description: "Artifact ID (art_...) to read." }),
})

export const UpdateToolInput = Schema.Struct({
  id: Artifact.ID.annotate({ description: "Artifact ID (art_...) to update." }),
  title: Schema.String.pipe(optional).annotate({ description: "Updated title, or omit to keep the current title." }),
  files: Schema.Record(Schema.String, Schema.String).annotate({
    description: "Replacement UTF-8 file map keyed by relative path.",
  }),
  entry: Schema.String.pipe(optional).annotate({ description: "Updated entry file path." }),
})

export const DeleteToolInput = Schema.Struct({
  id: Artifact.ID.annotate({ description: "Artifact ID (art_...) to delete." }),
})

const DeleteToolOutput = Schema.Struct({
  id: Artifact.ID,
  deleted: Schema.Boolean,
})

export const Plugin = {
  id: "opencode.tool.artifact",
  effect: Effect.fn("ArtifactTools.Plugin")(function* (ctx: Context) {
    const config = yield* Config.Service
    const artifacts = yield* Artifact.Service

    const promptSnapshot = { text: yield* renderCreateDescription(artifacts) }
    const refreshTools = Effect.gen(function* () {
      promptSnapshot.text = yield* renderCreateDescription(artifacts)
      yield* ctx.tool.reload()
    })

    const loaded = yield* ConfigEntryObserver.observe(config, ctx.event, refreshTools)
    yield* ctx.event.subscribe({ types: [Artifact.Event.Updated.type] }).pipe(
      Stream.runForEach(() => refreshTools),
      Effect.forkScoped({ startImmediately: true }),
    )

    const enabled = () => Config.latest(loaded.entries, "experimental")?.artifacts === true
    const failure = (error: { readonly message: string }) => new ToolFailure({ message: error.message, error })

    yield* ctx.tool
      .transform((editor) => {
        if (!enabled()) return

        editor.add({
          name: "artifact_create",
          description: promptSnapshot.text,
          input: CreateToolInput,
          output: Artifact.Info,
          options: { namespace: "opencode", codemode: true },
          execute: (input, context) =>
            artifacts
              .create({
                title: input.title,
                files: input.files,
                entry: input.entry,
                provider: input.provider === undefined ? undefined : Artifact.ProviderID.make(input.provider),
                sessionID: context.sessionID,
              })
              .pipe(
                Effect.map((info) => ({
                  output: info,
                  content: `Published ${info.title} (${info.id} via ${info.provider}): ${info.url}`,
                })),
                Effect.mapError(failure),
              ),
        })

        editor.add({
          name: "artifact_read",
          description: "Read an artifact's metadata and file contents so you can inspect or update it.",
          input: ReadToolInput,
          output: Artifact.Content,
          options: { namespace: "opencode", codemode: true },
          execute: (input) =>
            artifacts.get(input.id).pipe(
              Effect.map((content) => ({
                output: content,
                content: `${content.info.title} (${content.info.id} · ${Object.keys(content.files).length} files)`,
              })),
              Effect.mapError(failure),
            ),
        })

        editor.add({
          name: "artifact_update",
          description: "Replace an existing artifact's files at the same ID and URL.",
          input: UpdateToolInput,
          output: Artifact.Info,
          options: { namespace: "opencode", codemode: true },
          execute: (input, context) =>
            artifacts
              .update(input.id, {
                title: input.title,
                files: input.files,
                entry: input.entry,
                sessionID: context.sessionID,
              })
              .pipe(
                Effect.map((info) => ({
                  output: info,
                  content: `Updated ${info.title} (${info.id}): ${info.url}`,
                })),
                Effect.mapError(failure),
              ),
        })

        editor.add({
          name: "artifact_delete",
          description: "Delete an artifact and remove its stored copy.",
          input: DeleteToolInput,
          output: DeleteToolOutput,
          options: { namespace: "opencode", codemode: true },
          execute: (input) =>
            artifacts.remove(input.id).pipe(
              Effect.map(() => ({
                output: { id: input.id, deleted: true },
                content: `Deleted ${input.id}`,
              })),
              Effect.mapError(failure),
            ),
        })
      })
      .pipe(Effect.orDie)
  }),
}

function renderCreateDescription(artifacts: Artifact.Interface) {
  return artifacts.prompts().pipe(
    Effect.map(({ defaultProvider, others }) => {
      const lines = [
        "Publish a new artifact to the default artifact provider or a named override.",
        `Default provider (${defaultProvider.id} [${defaultProvider.capabilities.join(", ")}]): ${defaultProvider.prompt}`,
      ]
      if (others.length > 0) {
        lines.push(
          `Other active providers (pass provider to override): ${others.map((item) => `${item.id} [${item.capabilities.join(", ")}]`).join(", ")}.`,
        )
      }
      return lines.join("\n")
    }),
  )
}
