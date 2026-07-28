import { ipcMain } from "electron"
import type { IpcMainEvent, IpcMainInvokeEvent } from "electron"
import { isTrustedIpcUrl } from "./ipc-origin"

type IpcEvent = IpcMainEvent | IpcMainInvokeEvent

export function handle<Args extends unknown[], Result>(
  channel: string,
  listener: (event: IpcMainInvokeEvent, ...args: Args) => Result,
) {
  ipcMain.handle(channel, (event, ...args) => {
    requireTrustedIpcSender(event)
    return listener(event, ...(args as Args))
  })
}

export function on<Args extends unknown[]>(
  channel: string,
  listener: (event: IpcMainEvent, ...args: Args) => void,
) {
  ipcMain.on(channel, (event, ...args) => {
    requireTrustedIpcSender(event)
    listener(event, ...(args as Args))
  })
}

function requireTrustedIpcSender(event: IpcEvent) {
  const frame = event.senderFrame
  if (frame === event.sender.mainFrame && isTrustedIpcUrl(frame.url)) return
  throw new Error("Rejected IPC from untrusted renderer")
}
