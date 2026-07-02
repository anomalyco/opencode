import type { SessionApi } from "./generated/api.js"

export type SessionDomain = Pick<SessionApi<unknown>, "create" | "get" | "prompt" | "command" | "interrupt">
