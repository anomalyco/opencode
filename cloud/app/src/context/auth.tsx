import { useSession } from "vinxi/http"
import { createClient } from "@openauthjs/openauth/client"

export const AuthClient = createClient({
  clientID: "app",
  issuer: "https://auth.dev.opencode.ai",
})

export interface AuthSession {
  account: Record<string, {
    id: string
    email: string
  }>
  current?: string
}

export function useAuthSession() {
  "use server"

  return useSession<AuthSession>({
    password: "0".repeat(32),
    name: "auth"
  })
}


export function AuthProvider() {
}
