import { createContext, useContext, type ParentProps } from "solid-js"
import { createOpencodeClient } from "@opencode-ai/sdk/client"

const host = import.meta.env.VITE_OPENCODE_SERVER_HOST ?? "127.0.0.1"
const defaultPort = import.meta.env.VITE_OPENCODE_SERVER_PORT ?? "56849"

type SDKContext = ReturnType<typeof createOpencodeClient>

const ctx = createContext<SDKContext>()

export function SDKProvider(props: ParentProps) {
  const value = createOpencodeClient({
    baseUrl: `http://${host}:${defaultPort}`,
  })

  return <ctx.Provider value={value}>{props.children}</ctx.Provider>
}

export function useSDK() {
  const value = useContext(ctx)
  if (!value) {
    throw new Error("useSDK must be used within a SDKProvider")
  }
  return value
}
