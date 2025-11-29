import { useSession } from "@solidjs/start/http"

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
    password: "0".repeat(32),
    name: "auth",
    maxAge: 60 * 60 * 24 * 365,
    cookie: {
      secure: false,
      httpOnly: true,
    },
  })
}
