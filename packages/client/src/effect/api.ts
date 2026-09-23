import type { WebsearchApi } from "./api/api.js"

export type { RpcApi, RpcClient } from "./rpc.js"

export type * from "./api/api.js"

export type WebSearchApi<E = never> = WebsearchApi<E>
