import { PersistentPty } from "@opencode/schema/persistent-pty"
import { Schema } from "effect"
import type { ExperimentalPersistentPtyConnectTokenInput, OpenCodeClient } from "../promise"

// Declares only the fields clients read, so servers can add or drop the rest without a client silently ignoring a
// message it depends on.
export const PersistentPtyMessage = Schema.Union([
  Schema.Struct({
    type: Schema.Literal("attached"),
    inputProtocol: Schema.optional(Schema.Number),
    info: Schema.Struct({ size: PersistentPty.Info.fields.size }),
    role: Schema.optional(Schema.Literals(["controller", "observer"])),
  }),
  Schema.Struct({ type: Schema.Literal("replay_complete") }),
  Schema.Struct({
    type: Schema.Literal("resized"),
    cols: Schema.Number,
    rows: Schema.Number,
    checkpoint: Schema.String,
  }),
  Schema.Struct({
    type: Schema.Literal("controller_changed"),
    attachmentID: Schema.optional(Schema.NullOr(Schema.String)),
  }),
  Schema.Struct({
    type: Schema.Literal("exited"),
    exitCode: Schema.optional(Schema.NullOr(Schema.Number)),
  }),
  Schema.Struct({ type: Schema.Literal("title_changed"), title: Schema.String }),
  Schema.Struct({ type: Schema.Literal("foreground_process_changed"), process: Schema.NullOr(Schema.String) }),
])
export type PersistentPtyMessage = typeof PersistentPtyMessage.Type

const decodeMessage = Schema.decodeUnknownOption(Schema.fromJsonString(PersistentPtyMessage))

export function decodePersistentPtyMessage(text: string) {
  return decodeMessage(text)
}

export function persistentPtyFrame(size: { cols: number; rows: number }, data?: Uint8Array) {
  const frame = new Uint8Array(5 + (data?.byteLength ?? 0))
  const view = new DataView(frame.buffer)
  frame[0] = data ? 1 : 0
  view.setUint16(1, size.cols)
  view.setUint16(3, size.rows)
  if (data) frame.set(data, 5)
  return frame
}

export type PtyClientOptions = {
  readonly url: string
  readonly openSocket?: (url: URL) => WebSocket
}

export type PersistentPtyConnectInput = {
  readonly ptyID: ExperimentalPersistentPtyConnectTokenInput["ptyID"]
  readonly cursor: number
  readonly attachmentID: string
  readonly takeover?: boolean
}

export function createPersistentPtyClient(api: OpenCodeClient, options: PtyClientOptions) {
  return {
    async connect(input: PersistentPtyConnectInput) {
      const token = await api.experimental.persistentPty.connectToken({
        ptyID: input.ptyID,
        "x-opencode-ticket": "1",
      })
      const baseUrl = new URL(options.url)
      if (!baseUrl.pathname.endsWith("/")) baseUrl.pathname += "/"
      const url = new URL(`api/experimental/persistent-pty/${encodeURIComponent(input.ptyID)}/connect`, baseUrl)
      url.searchParams.set("ticket", token.ticket)
      url.searchParams.set("cursor", String(input.cursor))
      url.searchParams.set("attachment_id", input.attachmentID)
      url.searchParams.set("takeover", String(input.takeover ?? false))
      url.searchParams.set("input_protocol", "1")
      url.protocol = url.protocol === "https:" ? "wss:" : "ws:"

      const socket = options.openSocket?.(url) ?? new WebSocket(url)
      socket.binaryType = "arraybuffer"
      return socket
    },
  }
}
