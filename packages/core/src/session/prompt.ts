export * as SessionPrompt from "./prompt.js"

import { Base64, FileAttachment, Prompt } from "@opencode-ai/schema/prompt"
import { PromptInput } from "@opencode-ai/schema/prompt-input"
import { SessionInbox } from "@opencode-ai/schema/session-inbox"
import type { Session } from "@opencode-ai/schema/session"
import type { SessionMessage } from "@opencode-ai/schema/session-message"
import { FSUtil } from "@opencode-ai/util/fs-util"
import { Context, Effect, Layer } from "effect"
import path from "path"
import { fileURLToPath } from "url"
import { Image } from "../image.js"
import { Mime } from "../mime.js"
import { PluginHooks } from "../plugin/hooks.js"
import { PluginSupervisor } from "../plugin/supervisor-service.js"
import { Skill } from "../skill.js"
import { AttachmentError, SkillNotFoundError } from "./error.js"

export type Input = {
  text: string
  files?: PromptInput.Prompt["files"]
  agents?: PromptInput.Prompt["agents"]
  skills?: PromptInput.Prompt["skills"]
  metadata?: Record<string, unknown>
  delivery?: SessionInbox.Delivery
}

export const make = Effect.fn("SessionPrompt.make")(function* () {
  const fs = yield* FSUtil.Service
  const plugins = yield* PluginSupervisor.Service
  const hooks = yield* PluginHooks.Service
  const image = yield* Image.Service
  const skillService = yield* Skill.Service

  const prepare = Effect.fn("SessionPrompt.prepare")(function* (request: {
    sessionID: Session.ID
    messageID: SessionMessage.ID
    input: Input
  }) {
    yield* plugins.flush
    const event = yield* hooks.trigger("session", "prompt", {
      sessionID: request.sessionID,
      messageID: request.messageID,
      prompt: structuredClone({
        text: request.input.text,
        files: request.input.files?.slice(),
        agents: request.input.agents?.slice(),
        skills: request.input.skills?.slice(),
      }),
      metadata: structuredClone(request.input.metadata),
      delivery: request.input.delivery ?? "steer",
    })
    const input = event.prompt
    const files = input.files
      ? yield* Effect.forEach(input.files, materializeAttachment, { concurrency: 8 })
      : undefined
    const requested = input.skills
    const selected = yield* Effect.gen(function* () {
      if (!requested?.length) return undefined
      const prepared = new Map<Skill.ID, Skill.Name>()
      return yield* Effect.forEach(requested, (attachment) =>
        Effect.gen(function* () {
          const name = prepared.get(attachment.id)
          if (name !== undefined) return { id: attachment.id, name, mention: attachment.mention }
          const skill = yield* skillService.get(attachment.id)
          if (!skill) return yield* new SkillNotFoundError({ skill: attachment.id })
          prepared.set(skill.id, skill.name)
          return {
            id: skill.id,
            name: skill.name,
            text: (yield* Skill.prepare(fs, skill).pipe(Effect.orDie)).output,
            mention: attachment.mention,
          }
        }),
      )
    })
    return {
      type: "user",
      payload: SessionInbox.UserPayload.make({
        ...Prompt.make({
          text: input.text,
          agents: input.agents,
          files,
          skills: selected?.length ? selected : undefined,
        }),
        metadata: event.metadata,
      }),
      delivery: SessionInbox.Delivery.make(event.delivery),
    } satisfies SessionInbox.Item
  })

  const materializeAttachment = Effect.fn("SessionPrompt.materializeAttachment")(function* (
    input: PromptInput.FileAttachment,
  ) {
    const resolved = input.uri.startsWith("data:")
      ? {
          bytes: yield* decodeDataURL(input.uri),
          source: { type: "inline" as const },
          start: undefined,
          end: undefined,
          name: undefined,
          mime: undefined,
        }
      : yield* readFileAttachment(input.uri)
    if (resolved.bytes.byteLength > MAX_ATTACHMENT_BYTES)
      return yield* new AttachmentError({
        uri: input.uri,
        message: `Attachment exceeds the ${MAX_ATTACHMENT_BYTES} byte limit: ${input.uri}`,
      })

    const mime = resolved.mime ?? Mime.detect(resolved.bytes)
    const content =
      mime === "text/plain" && resolved.start !== undefined
        ? Buffer.from(
            Buffer.from(resolved.bytes)
              .toString("utf8")
              .split("\n")
              .slice(resolved.start - 1, resolved.end)
              .join("\n"),
          )
        : resolved.bytes
    const normalized = yield* normalizeImageAttachment(input, Buffer.from(content).toString("base64"), mime)
    return FileAttachment.create({
      data: normalized.data,
      mime: normalized.mime,
      source: resolved.source,
      name: input.name ?? resolved.name,
      description: input.description,
      mention: input.mention,
    })
  })

  const normalizeImageAttachment = Effect.fn("SessionPrompt.normalizeImageAttachment")(function* (
    input: PromptInput.FileAttachment,
    data: string,
    mime: string,
  ) {
    if (!mime.startsWith("image/")) return { data: Base64.make(data), mime }
    const label = input.name ?? (input.uri.startsWith("data:") ? "inline attachment" : input.uri)
    const content = { uri: label, content: data, encoding: "base64" as const, mime }
    const normalized = yield* image.normalize(label, content).pipe(
      Effect.catchTag("Image.ResizerUnavailableError", () => Effect.succeed(content)),
      Effect.mapError((error) => new AttachmentError({ uri: label, message: error.message })),
    )
    return { data: Base64.make(normalized.content), mime: normalized.mime }
  })

  const readFileAttachment = Effect.fn("SessionPrompt.readFileAttachment")(function* (uri: string) {
    const url = yield* Effect.try({
      try: () => new URL(uri),
      catch: () => new AttachmentError({ uri, message: `Invalid attachment URI: ${uri}` }),
    })
    if (url.protocol !== "file:")
      return yield* new AttachmentError({ uri, message: `Unsupported attachment URI: ${uri}` })
    const start = positiveInt(url.searchParams.get("start"))
    const end = positiveInt(url.searchParams.get("end"))
    const target = yield* Effect.try({
      try: () => {
        url.search = ""
        url.hash = ""
        return fileURLToPath(url)
      },
      catch: () => new AttachmentError({ uri, message: `Invalid file URI: ${uri}` }),
    })
    const info = yield* fs
      .stat(target)
      .pipe(Effect.mapError(() => new AttachmentError({ uri, message: `Unable to read attachment: ${uri}` })))
    if (info.type === "Directory") {
      const entries = yield* fs
        .readDirectoryEntries(target)
        .pipe(Effect.mapError(() => new AttachmentError({ uri, message: `Unable to read attachment: ${uri}` })))
      return {
        bytes: Buffer.from(
          entries
            .filter((entry) => entry.type === "file" || entry.type === "directory")
            .sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === "directory" ? -1 : 1))
            .map((entry) => entry.name + (entry.type === "directory" ? path.sep : ""))
            .join("\n"),
        ),
        source: { type: "uri" as const, uri },
        start: undefined,
        end: undefined,
        name: path.basename(target),
        mime: "application/x-directory",
      }
    }
    if (info.type !== "File") return yield* new AttachmentError({ uri, message: `Attachment is not a file: ${uri}` })
    if (Number(info.size) > MAX_ATTACHMENT_BYTES)
      return yield* new AttachmentError({
        uri,
        message: `Attachment exceeds the ${MAX_ATTACHMENT_BYTES} byte limit: ${uri}`,
      })
    const bytes = yield* fs
      .readFile(target)
      .pipe(Effect.mapError(() => new AttachmentError({ uri, message: `Unable to read attachment: ${uri}` })))
    return { bytes, source: { type: "uri" as const, uri }, start, end, name: path.basename(target), mime: undefined }
  })

  return { prepare }
})

export type Interface = Effect.Success<ReturnType<typeof make>>

export class Service extends Context.Service<Service, Interface>()("@opencode/SessionPrompt") {}

export const layer = Layer.effect(Service, make())

const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024

function decodeDataURL(uri: string) {
  return Effect.try({
    try: () => {
      const comma = uri.indexOf(",")
      if (comma === -1) throw new Error("Invalid data URL")
      const metadata = uri.slice(5, comma)
      const payload = uri.slice(comma + 1)
      if (!metadata.split(";").some((part) => part.toLowerCase() === "base64"))
        return Buffer.from(decodeURIComponent(payload))
      const bytes = Buffer.from(payload, "base64")
      if (bytes.toString("base64") !== payload) throw new Error("Non-canonical base64")
      return bytes
    },
    catch: () => new AttachmentError({ uri, message: "Invalid attachment data URL" }),
  })
}

function positiveInt(value: string | null) {
  if (value === null) return
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined
}
