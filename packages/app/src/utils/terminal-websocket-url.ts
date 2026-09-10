import { authTokenFromCredentials } from "@/utils/server"

export function terminalWebSocketURL(input: {
  protocol?: "v1" | "v2"
  url: string
  id: string
  directory: string
  cursor: number
  ticket?: string
  sameOrigin?: boolean
  username?: string
  password?: string
  authToken?: boolean
}) {
  const isV1 = input.protocol === "v1"
  const next = new URL(`${input.url}${isV1 ? `/pty/${input.id}/connect` : `/api/pty/${input.id}/connect`}`)
  if (isV1) {
    next.searchParams.set("directory", input.directory)
  } else {
    next.searchParams.set("location[directory]", input.directory)
  }
  next.searchParams.set("cursor", String(input.cursor))
  next.protocol = next.protocol === "https:" ? "wss:" : "ws:"
  if (input.ticket) {
    next.searchParams.set("ticket", input.ticket)
    return next
  }
  if (isV1 && input.password && (!input.sameOrigin || input.authToken)) {
    next.searchParams.set(
      "auth_token",
      authTokenFromCredentials({ username: input.username, password: input.password }),
    )
  }
  return next
}
