export function terminalWebSocketURL(input: {
  url: string
  id: string
  directory: string
  cursor: number
  sameOrigin: boolean
  username: string
  password?: string
}) {
  const next = new URL(`${input.url}/pty/${input.id}/connect`)
  next.searchParams.set("directory", input.directory)
  next.searchParams.set("cursor", String(input.cursor))
  next.protocol = next.protocol === "https:" ? "wss:" : "ws:"
  if (!input.sameOrigin && input.password)
    next.searchParams.set("auth_token", btoa(`${input.username}:${input.password}`))
  return next
}
