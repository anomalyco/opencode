import type { ExperimentalPersistentPtyConnectTokenInput, OpenCodeClient, PtyConnectTokenInput } from "../promise"

export type PtyClientOptions = {
  readonly url: string
  readonly openSocket?: (url: URL) => WebSocket
}

export type PtyConnectInput = {
  readonly ptyID: PtyConnectTokenInput["ptyID"]
  readonly location?: PtyConnectTokenInput["location"]
  readonly cursor?: number
}

export type PersistentPtyConnectInput = {
  readonly ptyID: ExperimentalPersistentPtyConnectTokenInput["ptyID"]
  readonly cursor: number
  readonly attachmentID: string
  readonly takeover?: boolean
}

export function createPtyClient(api: OpenCodeClient, options: PtyClientOptions) {
  return {
    async connect(input: PtyConnectInput) {
      const result = await api.pty.connect.token({
        ptyID: input.ptyID,
        location: input.location,
        "x-opencode-ticket": "1",
      })
      const url = connectUrl(options.url, `api/pty/${encodeURIComponent(input.ptyID)}/connect`)
      if (input.location?.directory) url.searchParams.set("location[directory]", input.location.directory)
      if (input.location?.workspace) url.searchParams.set("location[workspace]", input.location.workspace)
      if (input.cursor !== undefined) url.searchParams.set("cursor", String(input.cursor))
      url.searchParams.set("ticket", result.data.ticket)
      url.protocol = url.protocol === "https:" ? "wss:" : "ws:"

      const socket = options.openSocket?.(url) ?? new WebSocket(url)
      socket.binaryType = "arraybuffer"
      return socket
    },
  }
}

export function createPersistentPtyClient(api: OpenCodeClient, options: PtyClientOptions) {
  return {
    async connect(input: PersistentPtyConnectInput) {
      const token = await api.experimental.persistentPty.connectToken({
        ptyID: input.ptyID,
        "x-opencode-ticket": "1",
      })
      const url = connectUrl(options.url, `api/experimental/persistent-pty/${encodeURIComponent(input.ptyID)}/connect`)
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

function connectUrl(server: string, path: string) {
  const base = new URL(server)
  base.pathname = base.pathname.replace(/\/$/, "") + "/"
  return new URL(path, base)
}
