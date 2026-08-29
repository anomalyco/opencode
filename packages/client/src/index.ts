export { ClientError, type ClientErrorReason } from "./generated/client-error"
export * as OpenCode from "./client"
export type { AttachmentUploadInput, ClientOptions, RequestOptions } from "./client"
export type OpenCodeClient = ReturnType<typeof import("./client").make>
export * from "./generated/types"
export type { EventsSubscribeOutput as OpenCodeEvent } from "./generated/types"
