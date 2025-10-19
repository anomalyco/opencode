import { createContext, useContext, type ParentProps } from "solid-js"
import { createOpencodeClient, OpencodeClient, createClient } from "@opencode-ai/sdk/client"

const host = import.meta.env.VITE_OPENCODE_SERVER_HOST ?? "localhost"
const defaultPort = import.meta.env.VITE_OPENCODE_SERVER_PORT ?? "4096"

type SDKContext = ReturnType<typeof createOpencodeClient>

const ctx = createContext<SDKContext>()

export function SDKProvider(props: ParentProps) {
  // Get directory from URL params or use desktop package directory as default
  const directory = typeof window !== 'undefined'
    ? new URLSearchParams(window.location.search).get('directory') || '/Users/jkneen/Documents/GitHub/flows/opencode-stt/packages/desktop'
    : '/Users/jkneen/Documents/GitHub/flows/opencode-stt/packages/desktop'

  // Create the base client first - use empty baseUrl since Vite proxy handles it
  const baseClient = createClient({
    baseUrl: "",
  })

  // Add request interceptor to inject directory query param
  baseClient.interceptors.request.use((request) => {
    const url = new URL(request.url)
    url.searchParams.set('directory', directory)
    const newUrl = url.toString()
    console.log('[SDK Interceptor]', request.url, '->', newUrl)
    return new Request(newUrl, request)
  })

  // Wrap in OpencodeClient
  const client = new OpencodeClient({ client: baseClient })

  return <ctx.Provider value={client}>{props.children}</ctx.Provider>
}

export function useSDK() {
  const value = useContext(ctx)
  if (!value) {
    throw new Error("useSDK must be used within a SDKProvider")
  }
  return value
}
