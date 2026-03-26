import { createSimpleContext } from "@opencode-ai/ui/context"
import { createStore } from "solid-js/store"
import { Show, createEffect, type ParentProps } from "solid-js"
import { usePlatform } from "@/context/platform"
import { useServer } from "@/context/server"
import { HostedLogin } from "@/components/hosted-login"

type User = {
  id: string
  email: string
  role: "admin" | "member"
  disabled: boolean
}

type Workspace = {
  id: string
  name: string
  path: string
  project_id: string
  enabled: boolean
  created_by: string
}

type Me = {
  enabled: boolean
  user?: User
}

async function body(res: Response) {
  const text = await res.text()
  if (!text) return
  return JSON.parse(text) as unknown
}

export const { use: useHosted, provider: HostedProvider } = createSimpleContext({
  name: "Hosted",
  init: () => {
    const server = useServer()
    const platform = usePlatform()

    const [state, setState] = createStore({
      ready: false,
      loading: false,
      enabled: false,
      user: undefined as User | undefined,
      workspaces: [] as Workspace[],
      error: "",
    })

    const fetcher = platform.fetch ?? globalThis.fetch

    async function request(path: string, init?: RequestInit) {
      const headers = new Headers(init?.headers)
      if (!headers.has("content-type") && init?.body) headers.set("content-type", "application/json")
      const res = await fetcher(`${server.url}${path}`, {
        ...init,
        credentials: "include",
        headers,
      })
      return {
        res,
        data: await body(res),
      }
    }

    async function refresh() {
      if (!server.url) return
      setState({
        ready: false,
        loading: true,
        error: "",
        enabled: false,
        user: undefined,
        workspaces: [],
      })

      const result = await request("/user/me").catch(() => undefined)
      const payload = result?.data as Me | undefined
      const workspaces =
        payload?.enabled && payload.user
          ? await request("/workspace")
              .then((value) => ((value.data as Workspace[] | undefined) ?? []).filter((item) => item.enabled))
              .catch(() => [])
          : []
      setState({
        ready: true,
        loading: false,
        error: "",
        enabled: payload?.enabled === true,
        user: payload?.user,
        workspaces,
      })
    }

    async function login(email: string, password: string) {
      setState("loading", true)
      setState("error", "")
      const result = await request("/user/login", {
        method: "POST",
        body: JSON.stringify({ email, password }),
      }).catch(() => undefined)

      if (!result?.res.ok) {
        const next = result?.data
        const message = next && typeof next === "object" && "message" in next ? String(next.message) : "Login failed"
        setState("loading", false)
        setState("error", message)
        return false
      }

      await refresh()
      return true
    }

    async function logout() {
      await request("/user/logout", { method: "POST" }).catch(() => undefined)
      await refresh()
    }

    async function createWorkspace(input: { name?: string; path: string }) {
      const result = await request("/workspace", {
        method: "POST",
        body: JSON.stringify(input),
      })
      if (!result.res.ok) {
        const next = result.data
        const message =
          next && typeof next === "object" && "message" in next ? String(next.message) : "Workspace registration failed"
        throw new Error(message)
      }
      await refresh()
      return result.data as Workspace
    }

    createEffect(() => {
      const url = server.url
      if (!url) return
      void refresh()
    })

    return {
      ready: () => state.ready,
      loading: () => state.loading,
      enabled: () => state.enabled,
      user: () => state.user,
      workspaces: () => state.workspaces,
      isAdmin: () => state.user?.role === "admin",
      error: () => state.error,
      refresh,
      login,
      logout,
      createWorkspace,
    }
  },
})

export function HostedGate(props: ParentProps) {
  const hosted = useHosted()
  return (
    <Show when={hosted.ready()} fallback={<div class="size-full" />}>
      <Show when={!hosted.enabled() || hosted.user()} fallback={<HostedLogin />}>
        {props.children}
      </Show>
    </Show>
  )
}
