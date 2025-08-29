import { hc } from "hono/client"
import { ApiType } from "@opencode/cloud-function/src/gateway"
import { useWorkspace } from "./context-workspace"
import { useOpenAuth } from "../../components/context-openauth"

export function useApi() {
  const workspace = useWorkspace()
  const auth = useOpenAuth()
  return hc<ApiType>(import.meta.env.VITE_API_URL, {
    async fetch(...args: Parameters<typeof fetch>): Promise<Response> {
      const [input, init] = args
      const request = input instanceof Request ? input : new Request(input, init)
      const headers = new Headers(request.headers)
      headers.set("authorization", `Bearer ${await auth.access()}`)
      headers.set("x-opencode-workspace", workspace.id)
      return fetch(
        new Request(request, {
          ...init,
          headers,
        }),
      )
    },
  })
}
