import type { DesktopTheme } from "@opencode-ai/ui/theme"
import type { ServerConnection } from "@/context/server"
import { authTokenFromCredentials } from "./server"

export async function fetchDesktopThemes(input: { server: ServerConnection.HttpBase; fetch?: typeof fetch }) {
  const response = await (input.fetch ?? globalThis.fetch)(new URL("/theme/desktop", input.server.url), {
    headers: input.server.password
      ? {
          Authorization: `Basic ${authTokenFromCredentials({ username: input.server.username, password: input.server.password })}`,
        }
      : undefined,
  })
  if (!response.ok) return []
  const json = (await response.json()) as { themes?: DesktopTheme[] }
  return Array.isArray(json.themes) ? json.themes : []
}
