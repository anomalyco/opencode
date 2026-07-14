import type { SessionApi } from "@opencode-ai/client/effect/api"

export type SessionDomain = Pick<SessionApi<unknown>, "create" | "get" | "prompt" | "command" | "interrupt">
