import { useSession } from "vinxi/http"

export interface AuthSession {
  account: Record<
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
    cookie: {
      secure: false,
      httpOnly: true,
    },
  })
}
