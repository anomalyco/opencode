import { useSession } from "@solidjs/start/http"
import { Resource } from "sst"

export interface AuthSession {
  account?: Record<
    string,
    {
      id: string
      email: string
    }
  >
  current?: string
}

export function useAuthSession() {
  return useSession<AuthSession>({
    password: Resource.ZEN_SESSION_SECRET.value,
    name: "auth",
    maxAge: 60 * 60 * 24 * 365,
    cookie: {
      secure: false,
      httpOnly: true,
    },
  })
}
