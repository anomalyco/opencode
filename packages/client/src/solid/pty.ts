import type { OpenCodeClient, PtyConnectTokenInput } from "../promise"

export type PtyClientOptions = {
  readonly url: string
  readonly openSocket?: (url: URL) => WebSocket
}

export type PtyConnectInput = {
  readonly ptyID: PtyConnectTokenInput["ptyID"]
  readonly location?: PtyConnectTokenInput["location"]
  readonly cursor?: number
}

export function createPtyClient(api: OpenCodeClient, options: PtyClientOptions) {
  return {
    async connect(input: PtyConnectInput) {
      const result = await api.pty.connect.token({
        ptyID: input.ptyID,
        location: input.location,
        "x-opencode-ticket": "1",
      })
      const url = new URL(`/api/pty/${encodeURIComponent(input.ptyID)}/connect`, options.url)
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
