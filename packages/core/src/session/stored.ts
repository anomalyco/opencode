export * as SessionStored from "./stored.js"

import { Schema } from "effect"
import { FileAttachment, MediaRef } from "@opencode/schema/prompt"
import { optional } from "@opencode/schema/schema"
import { UserPayload as InboxUserPayload } from "@opencode/schema/session-inbox"
import { Tool } from "@opencode/schema/tool"
import { SessionMessage } from "./message.js"

/**
 * Stored rows may reference a `blob` row as `media:` and the lowercase hex SHA-256 of its raw bytes. The blob
 * row holds the bytes and size; the ref names no server route.
 */
export const Ref = MediaRef
export type Ref = MediaRef

/** The `blob` hash a {@link Ref} names. */
export const refHash = (ref: Ref) => ref.slice("media:".length)

/** The {@link Ref} naming a `blob` hash. */
export const ref = (hash: string): Ref => `media:${hash}`

const { data: _, ...attachment } = FileAttachment.fields

/** A user file whose bytes live in `blob`. */
export interface FileRef extends Schema.Schema.Type<typeof FileRef> {}
export const FileRef = Schema.Struct({ ...attachment, uri: Ref })

export const File = Schema.Union([FileAttachment, FileRef])
export type File = typeof File.Type

/** A tool result file whose bytes live in `blob`. */
export interface ToolFileRef extends Schema.Schema.Type<typeof ToolFileRef> {}
export const ToolFileRef = Schema.Struct({ ...Tool.FileContent.fields, uri: Ref })

const files = Schema.Array(File).pipe(optional)

/** A `session_inbox` user payload as stored, whose files may be refs. */
export interface UserPayload extends Schema.Schema.Type<typeof UserPayload> {}
export const UserPayload = Schema.Struct({ ...InboxUserPayload.fields, files })

/** A `session_message` user message as stored, whose files may be refs. */
export interface User extends Schema.Schema.Type<typeof User> {}
export const User = Schema.Struct({ ...SessionMessage.User.fields, files })
