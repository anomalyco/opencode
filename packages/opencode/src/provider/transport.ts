export const INTERNAL_TRANSPORT_PURPOSE_HEADER = "x-opencode-internal-transport-purpose"

export const PURPOSE = {
  conversation: "conversation",
  title: "title",
} as const

export type Purpose = (typeof PURPOSE)[keyof typeof PURPOSE]

export function purposeForAgent(agent: string): Purpose {
  if (agent === "title") return PURPOSE.title
  return PURPOSE.conversation
}

export function withoutInternalHeaders<T extends { headers?: HeadersInit }>(init: T | undefined): T | undefined {
  if (!init?.headers) return init
  return {
    ...init,
    headers: stripInternalHeaders(init.headers),
  }
}

export function stripInternalHeaders(headers: HeadersInit): HeadersInit {
  if (headers instanceof Headers) {
    const next = new Headers(headers)
    next.delete(INTERNAL_TRANSPORT_PURPOSE_HEADER)
    return next
  }

  if (Array.isArray(headers)) {
    return headers.filter((item) => item[0].toLowerCase() !== INTERNAL_TRANSPORT_PURPOSE_HEADER)
  }

  return Object.fromEntries(
    Object.entries(headers).filter(([key]) => key.toLowerCase() !== INTERNAL_TRANSPORT_PURPOSE_HEADER),
  )
}

export * as ProviderTransport from "./transport"
