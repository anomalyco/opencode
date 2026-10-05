import { RpcClient, RpcClientError } from "effect/unstable/rpc"
import { AppRpcs } from "./ipc-rpc/app"
import { EventRpcs } from "./ipc-rpc/events"
import { ExtensionRpcs } from "./ipc-rpc/extensions"
import { FileRpcs } from "./ipc-rpc/files"
import { MenuRpcs } from "./ipc-rpc/menu"
import { StorageRpcs } from "./ipc-rpc/storage"
import { WindowRpcs } from "./ipc-rpc/window"

export { AppRpcs } from "./ipc-rpc/app"

export { EventRpcs } from "./ipc-rpc/events"

export { ExtensionRpcs } from "./ipc-rpc/extensions"

export { FileRpcs } from "./ipc-rpc/files"

export { MenuRpcs } from "./ipc-rpc/menu"

export { StorageRpcs } from "./ipc-rpc/storage"

export { WindowRpcs } from "./ipc-rpc/window"

export const DesktopRpcs = AppRpcs.merge(StorageRpcs, FileRpcs, WindowRpcs, MenuRpcs, EventRpcs, ExtensionRpcs)

export type DesktopRpcClient = RpcClient.FromGroup<typeof DesktopRpcs, RpcClientError.RpcClientError>
