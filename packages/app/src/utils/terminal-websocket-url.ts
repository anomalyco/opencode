import { authTokenFromCredentials } from "@/utils/server"

export function terminalWebSocketURL(input: {
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
  const next = new URL(`${input.url}/pty/${input.id}/connect`)
  next.searchParams.set("directory", input.directory)
  next.searchParams.set("cursor", String(input.cursor))
  next.protocol = next.protocol === "https:" ? "wss:" : "ws:"
  if (input.ticket) {
    next.searchParams.set("ticket", input.ticket)
    return next
  }
  if (input.password && (!input.sameOrigin || input.authToken))
    next.searchParams.set(
      "auth_token",
      authTokenFromCredentials({ username: input.username, password: input.password }),
    )
  return next
}
