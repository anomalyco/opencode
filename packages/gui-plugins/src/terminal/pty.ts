import { createPersistentPtyClient } from "@opencode/client/solid"
import type { ServerRef } from "@opencode/plugin/gui"
import type { TerminalSize } from "./connection-machine"

export type PtySocket = Pick<WebSocket, "readyState" | "addEventListener" | "send" | "close">

/** The screen checkpoint and live stream of one persistent terminal. */
export type Pty = {
  snapshot(): Promise<{ info: { size: TerminalSize; output: { tail: number } }; checkpoint: string }>
  connect(cursor: number, attachmentID: string): Promise<PtySocket>
}

export const persistentTerminal = (server: ServerRef, ptyID: string): Pty => ({
  snapshot: () => server.client.experimental.persistentPty.snapshot({ ptyID }),
  connect: (cursor, attachmentID) =>
    createPersistentPtyClient(server.client, { url: server.url }).connect({
      ptyID,
      cursor,
      attachmentID,
      takeover: true,
    }),
})
