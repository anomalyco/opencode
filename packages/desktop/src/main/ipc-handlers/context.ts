import type { IpcPortHandoff } from "../ipc-transport"

export type RpcContext = { readonly client: { readonly id: number } }

export function sender(handoff: IpcPortHandoff["Service"], context: RpcContext) {
  const contents = handoff.sender(context.client.id)
  if (!contents || contents.isDestroyed()) throw new Error("Renderer connection not found")
  return contents
}
