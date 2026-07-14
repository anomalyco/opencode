import type { SessionApi } from "@opencode-ai/client/promise/api"

export type SessionDomain = Pick<SessionApi, "create" | "get" | "prompt" | "command" | "interrupt">
