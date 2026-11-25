export * as ArtifactTools from "./artifact.js"

import { ToolFailure } from "@opencode/ai/effect"
import type { Context } from "@opencode/plugin/effect/plugin"
import { optional } from "@opencode/schema/schema"
import { FSUtil } from "@opencode/util/fs-util"
import path from "path"
import { Effect, Schema, Stream } from "effect"
import { Artifact } from "../../artifact.js"
import { Config } from "../../config.js"
import { ConfigEntryObserver } from "../../config/plugin/entry-observer.js"
import { Environment } from "../../environment/index.js"
import { FileAccess } from "../../file-access.js"
import { Flag } from "../../flag.js"
import { Location } from "../../location.js"
import { Permission } from "../../permission.js"

const Files = Schema.Record(Schema.String, Schema.String).pipe(optional)
const Directory = Schema.String.pipe(optional).annotate({
  description:
    "Folder to publish, such as a build's output. Dotfiles and node_modules are skipped. Pass this or files, not both.",
})

export const CreateToolInput = Schema.Struct({
  title: Schema.String.annotate({ description: "Human-readable artifact title." }),
  files: Files.annotate({
    description:
      "UTF-8 file map keyed by relative path (for example index.html and assets/app.js). Pass this or directory, not both.",
  }),
  directory: Directory,
  entry: Schema.String.pipe(optional).annotate({
    description:
      "Entry file path relative to the artifact root, or to the assets folder with artifact.json. Defaults to index.html, index.md, or the sole file.",
  }),
  provider: Schema.String.pipe(optional).annotate({
    description: "Artifact provider ID to override the default provider for this request.",
  }),
  visibility: Artifact.Visibility.pipe(optional).annotate({
    description: "Who can open it: one of the provider's audiences. Defaults to the provider's default audience.",
  }),
})

export const ReadToolInput = Schema.Struct({
  id: Artifact.ID.annotate({ description: "Artifact ID (art_...) to read." }),
})

export const UpdateToolInput = Schema.Struct({
  id: Artifact.ID.annotate({ description: "Artifact ID (art_...) to update." }),
  title: Schema.String.pipe(optional).annotate({ description: "Updated title, or omit to keep the current title." }),
  files: Files.annotate({
    description: "Replacement UTF-8 file map keyed by relative path. Pass this or directory, not both.",
  }),
  directory: Directory,
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
    const access = yield* FileAccess.Service
    const permission = yield* Permission.Service
    const fsutil = yield* FSUtil.Service
    const location = yield* Location.Service
    const currentWorkingDirectory = yield* Environment.workingDirectoryResolver

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

    const flags = yield* Flag.Service
    const enabled = () => flags.resolve(loaded.entries).artifacts.enabled
    const failure = (error: { readonly message: string }) => new ToolFailure({ message: error.message, error })

    // The given files, or a folder's, which are the whole artifact.
    const source = (
      input: { readonly files?: Record<string, string>; readonly directory?: string },
      context: FileAccess.Invocation,
    ) =>
      Effect.gen(function* () {
        const directory = input.directory
        if (input.files !== undefined && directory === undefined) return { files: input.files, complete: false }
        if (input.files !== undefined || directory === undefined)
          return yield* new ToolFailure({ message: "Pass either files or directory" })
        const files = yield* readFolder(directory, context).pipe(
          Effect.catchIf(
            (error) =>
              error instanceof Environment.NotFound ||
              error instanceof Environment.WrongKind ||
              error instanceof Environment.Failed,
            (error) => Effect.fail(new ToolFailure({ message: `Unable to read ${directory}`, error })),
          ),
        )
        return { files, complete: true }
      })

    // Reads a folder the caller may read: with artifact.json only what it declares, and every file's own read rules
    // checked before any bytes are. Symlinks inside it are refused, so nothing outside it is published.
    const readFolder = Effect.fnUntraced(function* (directory: string, context: FileAccess.Invocation) {
      const folder = yield* access.authorizeRead(directory, context)
      const files = folder.environment.files
      const rules = folder.environment.path ?? path
      const root = folder.machine === undefined ? yield* realFolder(folder, context) : folder.absolute
      const refuse = (message: string) => Effect.fail(new ToolFailure({ message }))
      if ((yield* files.stat(root)).type !== "directory") return yield* refuse(`${folder.resource} is not a folder`)
      const place = { absolute: folder.absolute, environment: { id: folder.environment.id } }
      const resolve = (relative: string) => access.resolve({ path: relative, base: place, kind: "file" })
      const authorize = (targets: readonly FileAccess.Target[]) =>
        permission.assert({
          action: "read",
          resources: targets.map((target) => target.resource),
          save: [FileAccess.always(folder)],
          ...Permission.invocation(context),
        })
      const absolute = (relative: string) => rules.join(root, ...relative.split("/"))
      const manifest = yield* files
        .stat(absolute(Artifact.manifestFile))
        .pipe(Effect.catchTag("Environment.NotFound", () => Effect.undefined))
      if (manifest !== undefined && manifest.type !== "file")
        return yield* refuse(`Can't publish ${Artifact.manifestFile}: symlinks and special files aren't published`)
      const raw =
        manifest === undefined
          ? undefined
          : yield* resolve(Artifact.manifestFile).pipe(
              Effect.flatMap((target) => authorize([target])),
              Effect.andThen(files.read(absolute(Artifact.manifestFile))),
              Effect.map((result) => result.bytes),
            )
      const declared = raw === undefined ? undefined : yield* Artifact.readManifest(raw)
      const out: Record<string, Uint8Array> = raw === undefined ? {} : { [Artifact.manifestFile]: raw }
      // Iterating an array visits what is pushed onto it while it runs, so this walks every subfolder.
      const pending = declared
        ? [declared.assets, declared.server, ...declared.migrations].filter((item) => item !== undefined)
        : [""]
      const found: { readonly relative: string; readonly size: number }[] = []
      for (const relative of pending) {
        // A declared path that doesn't exist is named by the artifact's own checks.
        const info = yield* files
          .stat(relative ? absolute(relative) : root)
          .pipe(Effect.catchTag("Environment.NotFound", () => Effect.undefined))
        if (info === undefined) continue
        if (info.type === "directory") {
          for (const entry of yield* files.list(relative ? absolute(relative) : root))
            if (!entry.name.startsWith(".") && entry.name !== "node_modules")
              pending.push(relative ? `${relative}/${entry.name}` : entry.name)
          continue
        }
        if (info.type !== "file")
          return yield* refuse(`Can't publish ${relative}: symlinks and special files aren't published`)
        if (info.size > maxFileBytes) return yield* refuse(`${relative} is over the 25 MiB limit for one file`)
        found.push({ relative, size: info.size })
      }
      if (found.reduce((total, file) => total + file.size, 0) > maxTotalBytes)
        return yield* refuse("The folder is over the 100 MiB limit")
      if (found.length > 0) yield* authorize(yield* Effect.forEach(found, (file) => resolve(file.relative)))
      for (const file of found) out[file.relative] = (yield* files.read(absolute(file.relative))).bytes
      return out
    })

    // A folder is read where it really is. When that's outside the working directory and project, as through a
    // symlinked folder or parent, reading it there needs approval too.
    const realFolder = Effect.fnUntraced(function* (folder: FileAccess.Target, context: FileAccess.Invocation) {
      const real = yield* fsutil.resolve(folder.absolute)
      if (real === folder.absolute) return real
      const worktree = location.project.directory
      const roots = yield* Effect.forEach(
        [(yield* currentWorkingDirectory).absolute, ...(worktree === path.parse(worktree).root ? [] : [worktree])],
        fsutil.resolve,
      )
      if (!roots.some((item) => FSUtil.contains(item, real))) yield* access.authorizeRead(real, context)
      return real
    })

    // Publishing past this server needs an explicit allow: a blanket `"permission": "allow"` doesn't grant it.
    const publish = (context: FileAccess.Invocation, title: string) => ({
      authorize: (target: Artifact.Target) =>
        permission.assert({
          action: "artifact_publish",
          resources: [`${target.destination}:${target.visibility}`],
          save: [`${target.destination}:${target.visibility}`],
          metadata: { title, ...target },
          ...Permission.invocation(context),
        }),
    })

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
            source(input, context)
              .pipe(
                Effect.flatMap((from) =>
                  artifacts.create(
                    {
                      title: input.title,
                      files: from.files,
                      entry: input.entry,
                      provider: input.provider === undefined ? undefined : Artifact.ProviderID.make(input.provider),
                      visibility: input.visibility,
                      sessionID: context.sessionID,
                    },
                    publish(context, input.title),
                  ),
                ),
              )
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
          description:
            "Read an artifact's metadata and file contents so you can inspect or update it. Binary files and text past 64 KiB a file or 256 KiB in all are listed in omitted with their byte size instead.",
          input: ReadToolInput,
          output: Artifact.Content,
          options: { namespace: "opencode", codemode: true },
          execute: (input) =>
            artifacts.get(input.id).pipe(
              Effect.map((content) => {
                const omitted = Object.entries(content.omitted)
                  .map(([filePath, bytes]) => `${filePath} (${bytes} bytes)`)
                  .join(", ")
                return {
                  output: content,
                  content: `${content.info.title} (${content.info.id} · ${Object.keys(content.files).length} files)${omitted ? `; omitted: ${omitted}` : ""}`,
                }
              }),
              Effect.mapError(failure),
            ),
        })

        editor.add({
          name: "artifact_update",
          description:
            "Replace an existing artifact's files at the same ID and URL. Files a read listed in omitted are kept unless you send that path, and can be overwritten but not deleted; text files you were shown and leave out are removed. A directory is the whole artifact, so a file it no longer has is removed.",
          input: UpdateToolInput,
          output: Artifact.Info,
          options: { namespace: "opencode", codemode: true },
          execute: (input, context) =>
            source(input, context)
              .pipe(
                Effect.flatMap((from) =>
                  artifacts.update(
                    input.id,
                    { title: input.title, files: from.files, entry: input.entry, sessionID: context.sessionID },
                    { ...publish(context, input.title ?? input.id), complete: from.complete },
                  ),
                ),
              )
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
      const describe = (item: Artifact.ProviderPrompts["others"][number]) =>
        `${item.id} [${item.capabilities.join(", ")}; ${item.audiences.join(", ")}]`
      const lines = [
        "Publish a new artifact to the default artifact provider or a named override.",
        `Default provider (${describe(defaultProvider)}): ${defaultProvider.prompt}`,
      ]
      if (others.length > 0) {
        lines.push(`Other active providers (pass provider to override): ${others.map(describe).join(", ")}.`)
      }
      lines.push(
        'Without artifact.json, every file is served as is. With it, only the assets folder is public: {"assets": "dist", "spa": true, "server": "server.js", "bindings": [{"name": "DB", "kind": "sqlite" | "kv" | "blob", "migrations": ["migrations"]}], "crons": [{"schedule": "0 * * * *", "path": "/tasks/hourly"}]}. Every key is optional, but name assets, server, or both, and keep them, migrations and artifact.json apart. A provider refuses what its capabilities lack.',
      )
      return lines.join("\n")
    }),
  )
}

const maxFileBytes = 25 * 1024 * 1024
const maxTotalBytes = 100 * 1024 * 1024
